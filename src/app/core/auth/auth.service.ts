import { Router } from '@angular/router';
import { Injectable, Injector } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject, Observable, Subject, catchError, finalize, firstValueFrom, from, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { UserContextModel } from '../models/userContextModel';
import { RegisterUserRequestModel } from '../models/registerUserRequestModel';
import { environment } from '../../../environments/environment';
import { LoginUserRequestModel } from '../models/loginUserRequestModel';
import { PushRegistrationService } from '../services/push/push-registration.service';
import { OfflineDbService } from '../offline/offline-db';
import { OrdersService } from '../services/order-service/orders.service';
import { normalizeRestaurantId, mergeRestaurantId } from './restaurant-id.util';
import { NATIVE_AUTH_HEADER, NativeAuthTokenService } from './native-auth-token.service';
import { acquireRefreshLeader, initRefreshCoordinator, releaseRefreshLeader, tryAcquireRefreshLeaderSync } from './auth-refresh-coordinator';
import {
  clearAuthRestaurantCtx,
  clearAuthUserCtx,
  migrateAuthCtxFromSessionStorage,
  readAuthRestaurantCtx,
  readAuthUserCtx,
  writeAuthRestaurantCtx,
  writeAuthUserCtx,
} from './auth-session.storage';
import { agentDebugLog } from '../debug/agent-debug.logger';

export function isHttpAuthFailure(err: unknown): boolean {
  const status = (err as HttpErrorResponse)?.status;
  return status === 401 || status === 403;
}

/** Normalizes API user payloads (camelCase or PascalCase). */
export function normalizeUserContext(raw: unknown): UserContextModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = (r['id'] ?? r['Id']) as string | undefined;
  const role = (r['role'] ?? r['Role']) as string | undefined;
  if (!id || !role) return null;

  const isOfflinePrimaryDevice = readOptionalBool(r, 'isOfflinePrimaryDevice', 'IsOfflinePrimaryDevice');
  const isOfflinePrimaryStaffDesignee = readOptionalBool(
    r,
    'isOfflinePrimaryStaffDesignee',
    'IsOfflinePrimaryStaffDesignee',
  );

  return {
    id,
    role,
    restaurantId: normalizeRestaurantId((r['restaurantId'] ?? r['RestaurantId'] ?? null) as string | null),
    restaurantName: (r['restaurantName'] ?? r['RestaurantName'] ?? null) as string | null,
    restaurantType: (r['restaurantType'] ?? r['RestaurantType'] ?? null) as string | null,
    displayName: (r['displayName'] ?? r['DisplayName'] ?? null) as string | null,
    name: (r['name'] ?? r['Name'] ?? null) as string | null,
    surname: (r['surname'] ?? r['Surname'] ?? null) as string | null,
    email: (r['email'] ?? r['Email'] ?? null) as string | null,
    ...(isOfflinePrimaryDevice !== undefined ? { isOfflinePrimaryDevice } : {}),
    ...(isOfflinePrimaryStaffDesignee !== undefined ? { isOfflinePrimaryStaffDesignee } : {}),
  };
}

function readOptionalBool(
  raw: Record<string, unknown>,
  camelKey: string,
  pascalKey: string,
): boolean | undefined {
  if (!(camelKey in raw) && !(pascalKey in raw)) return undefined;
  return readBool(raw[camelKey] ?? raw[pascalKey]);
}

function readBool(value: unknown): boolean {
  return value === true || value === 'true';
}

function mergeUserContext(
  incoming: UserContextModel,
  previous: UserContextModel | null,
): UserContextModel {
  return {
    ...incoming,
    restaurantId: mergeRestaurantId(incoming.role, incoming.restaurantId, previous?.restaurantId),
    restaurantName: incoming.restaurantName ?? previous?.restaurantName ?? null,
    restaurantType: incoming.restaurantType ?? previous?.restaurantType ?? null,
    displayName: incoming.displayName ?? previous?.displayName ?? null,
    name: incoming.name ?? previous?.name ?? null,
    surname: incoming.surname ?? previous?.surname ?? null,
    email: incoming.email ?? previous?.email ?? null,
    isOfflinePrimaryDevice: incoming.isOfflinePrimaryDevice ?? previous?.isOfflinePrimaryDevice ?? false,
    isOfflinePrimaryStaffDesignee: incoming.isOfflinePrimaryStaffDesignee ?? previous?.isOfflinePrimaryStaffDesignee ?? false,
  };
}

function isRefreshSuccess(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true;
  const r = raw as Record<string, unknown>;
  if ('isSuccess' in r) return r['isSuccess'] === true;
  if ('IsSuccess' in r) return r['IsSuccess'] === true;
  return true;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<UserContextModel | null>(null);
  user$: Observable<UserContextModel | null> = this.userSubject.asObservable();
  readonly loggedIn$ = new Subject<void>();
  // use environment variable
  private apiUrl = environment.apiUrl;
  /** Shared in-flight refresh stream — assigned synchronously before HTTP subscribe. */
  private refreshShared$: Observable<UserContextModel | null> | null = null;

  constructor(
    private http: HttpClient,
    private router: Router,
    private injector: Injector,
    private nativeAuthTokens: NativeAuthTokenService,
  ) {
    migrateAuthCtxFromSessionStorage();
  }

  // --- Public API ---

  // auth.service.ts
  getUserSnapshot(): UserContextModel | null {
    return this.userSubject?.value ?? null;
  }

  getUserContext(): Observable<UserContextModel | null> {
    return this.user$;
  }

  /**
   * Re-hydrate in-memory session from UserCtx when storage still has a session but
   * userSubject was not populated yet (startup race) or was cleared without storage.
   */
  hydrateSessionFromStorageIfNeeded(): void {
    if (this.userSubject.value) {
      return;
    }
    const user = readAuthUserCtx();
    if (!user?.id || !user?.role) {
      return;
    }
    this.userSubject.next(user);
    this.setRestaurantCtx();
  }

  isAuthenticated(): boolean {
    this.hydrateSessionFromStorageIfNeeded();
    return this.userSubject.value !== null;
  }

  getUserRole(): string | null {
    this.hydrateSessionFromStorageIfNeeded();
    return this.userSubject.value?.role ?? null;
  }

  getUserRestaurantId(): string | string[] | null {
    this.hydrateSessionFromStorageIfNeeded();
    const id = this.userSubject.value?.restaurantId ?? null;
    if (Array.isArray(id)) {
      const assigned = id.map(v => normalizeRestaurantId(v)).filter((v): v is string => v != null);
      return assigned.length ? assigned : null;
    }
    return normalizeRestaurantId(id);
  }

  loginUser(payload: LoginUserRequestModel): Observable<unknown> {
    const url = `${this.apiUrl}/api/user/login`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.nativeAuthTokens.isEnabled()) {
      headers[NATIVE_AUTH_HEADER] = '1';
    }
    return this.http.post(url, payload, {
      headers,
      withCredentials: true,
    }).pipe(
      tap((response) => {
        this.nativeAuthTokens.captureFromAuthPayload(response);
      }),
    );
  }

  registerUser(payload: RegisterUserRequestModel): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/user/register`, payload, {
      headers: { 'Content-Type': 'application/json' }, withCredentials: true
    });
  }

  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/api/user/forgot-password`,
      { email },
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  resetPassword(token: string, newPassword: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/api/user/reset-password`,
      { token, newPassword },
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  verifyEmail(token: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/api/user/verify-email`,
      { token },
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  resendVerification(email: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/api/user/resend-verification`,
      { email },
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  // --- Session management ---
  setUser(raw: UserContextModel | Record<string, unknown>): void {
    const wasLoggedOut = !this.userSubject.value;
    const previous = this.userSubject.value;
    const incoming = normalizeUserContext(raw) ?? (raw as UserContextModel);
    const merged = mergeUserContext(incoming, previous);
    this.userSubject.next(merged);
    writeAuthUserCtx(merged);
    this.setRestaurantCtx();

    if (wasLoggedOut) {
      this.loggedIn$.next();  // ← emite doar la login real, nu la restore session
    }
  }

  setRestaurantCtx(): void {
    const ctx = {
      name: this.userSubject.value?.restaurantName ?? '',
      type: this.userSubject.value?.restaurantType ?? ''
    };

    writeAuthRestaurantCtx(ctx);
  }

  clearRestaurantCtx(): void {
    clearAuthRestaurantCtx();
  }

  getRestaurantCtx() {
    return readAuthRestaurantCtx();
  }


  clearUser(): void {
    this.userSubject.next(null);
    clearAuthUserCtx();
    void this.nativeAuthTokens.clear();
  }

  /**
   * Native startup: restore local UserCtx then validate/renew via stored refresh token.
   * Does not navigate on failure — caller shows login when unauthenticated.
   */
  async tryRestoreNativeSession(): Promise<UserContextModel | null> {
    await this.nativeAuthTokens.initialize();
    await firstValueFrom(this.restoreSession());
    if (this.nativeAuthTokens.isAccessTokenValid()) {
      return this.getUserSnapshot();
    }
    return firstValueFrom(this.refreshUserContext({ redirectOnFailure: false }));
  }

  /** Web startup: restore UserCtx then validate/renew via HttpOnly refresh cookie. */
  async tryRestoreWebSession(): Promise<UserContextModel | null> {
    initRefreshCoordinator();
    migrateAuthCtxFromSessionStorage();
    await this.nativeAuthTokens.initialize();
    await firstValueFrom(this.restoreSession());

    if (this.isAuthenticated()) {
      // Cookie JWT may still be valid — ping first; refresh only on 401.
      const pinged = await firstValueFrom(this.pingSession(false));
      return pinged ?? this.getUserSnapshot();
    }

    // No local UserCtx (new tab / cleared storage) — cookie may still be valid.
    return firstValueFrom(this.refreshUserContext({ redirectOnFailure: false }));
  }

  restoreSession(): Observable<UserContextModel | null> {
    const user = readAuthUserCtx();
    if (user) {
      this.userSubject.next(user);
      writeAuthUserCtx(user);
      this.setRestaurantCtx();
      return of(user);
    }

    this.userSubject.next(null);
    this.clearRestaurantCtx();
    return of(null);
  }
  // --- Refresh from backend ---

  pingSession(isPublic: boolean = false): Observable<UserContextModel | null> {
    const buildPingOptions = () => ({
      withCredentials: true,
      headers: this.nativeAuthTokens.authHeaders(),
    });
    return this.http.get<unknown>(`${this.apiUrl}/api/user/ping`, buildPingOptions()).pipe(
      map(raw => normalizeUserContext(raw)),
      tap(user => {
        if (user) this.setUser(user);
      }),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && !isPublic) {
          agentDebugLog('A1', 'auth.pingSession', 'ping-401-refresh', {
            hasBearer: !!this.nativeAuthTokens.getAccessToken(),
            hasRefresh: !!this.nativeAuthTokens.getRefreshToken(),
          });
          return this.refreshUserContext({ redirectOnFailure: false }).pipe(
            switchMap(user => {
              this.hydrateSessionFromStorageIfNeeded();
              if (!user && !this.isAuthenticated()) {
                agentDebugLog('A1', 'auth.pingSession', 'logout-after-refresh-fail', {});
                console.warn('Refresh credentials failed. Redirect @Login.');
                this.clearUser();
                this.clearRestaurantCtx();
                return of(null);
              }
              // Re-read Bearer after refresh — do not reuse the expired header snapshot.
              return this.http.get<unknown>(`${this.apiUrl}/api/user/ping`, buildPingOptions()).pipe(
                map(raw => normalizeUserContext(raw)),
                tap(u => {
                  if (u) this.setUser(u);
                }),
                catchError(() => {
                  agentDebugLog('A1', 'auth.pingSession', 'logout-ping-retry-fail', {});
                  this.clearUser();
                  this.clearRestaurantCtx();
                  return of(null);
                }),
              );
            }),
          );
        }
        if (error.status === 401) {
          this.clearUser();
          this.clearRestaurantCtx();
        }
        console.warn('Ping failed, but route is public or error is not 401.');
        return of(null);
      })
    );
  }

  refreshUserContext(options?: { redirectOnFailure?: boolean }): Observable<UserContextModel | null> {
    const redirectOnFailure = options?.redirectOnFailure ?? true;
    if (this.refreshShared$) {
      return this.refreshShared$;
    }

    const refresh$ = (this.nativeAuthTokens.isEnabled()
      ? from(this.nativeAuthTokens.initialize())
      : of(undefined)
    ).pipe(
      switchMap(() => {
        if (this.nativeAuthTokens.isEnabled()) {
          return from(acquireRefreshLeader());
        }
        const syncRole = tryAcquireRefreshLeaderSync();
        if (syncRole === 'contended') {
          return from(acquireRefreshLeader());
        }
        return of(syncRole);
      }),
      switchMap((role) => {
        if (role === 'follower') {
          // Leader already rotated refresh tokens; a second refresh revokes the session.
          const reload$ = this.nativeAuthTokens.isEnabled()
            ? from(this.nativeAuthTokens.reloadFromStorage())
            : of(undefined);
          return reload$.pipe(
            map(() => {
              this.hydrateSessionFromStorageIfNeeded();
              return this.getUserSnapshot();
            }),
          );
        }

        const refreshToken =
          this.nativeAuthTokens.getRefreshToken() ??
          this.nativeAuthTokens.takeWebLegacyRefreshToken();
        const refreshBody = refreshToken ? { refreshToken } : {};
        const refreshHeaders: Record<string, string> = {};
        if (this.nativeAuthTokens.isEnabled()) {
          refreshHeaders[NATIVE_AUTH_HEADER] = '1';
        }

        // Cookie web: empty body is fine (credentials carry RefreshToken).
        // Native: must have a stored refresh token.
        const sentRefreshToken = !this.nativeAuthTokens.isEnabled() || !!refreshToken;

        agentDebugLog('A2', 'auth.refreshUserContext', 'refresh-start', {
          role,
          hasRefreshToken: !!refreshToken,
          sentRefreshToken,
          native: this.nativeAuthTokens.isEnabled(),
          redirectOnFailure,
        });

        return this.http
          .post<unknown>(`${this.apiUrl}/api/user/refresh-token`, refreshBody, {
            withCredentials: true,
            headers: refreshHeaders,
          })
          .pipe(
            tap((raw) => {
              this.nativeAuthTokens.captureFromAuthPayload(raw);
            }),
            map(raw => this.resolveUserAfterRefresh(raw)),
            tap(user => {
              if (user) this.setUser(user);
            }),
            catchError(err => {
              console.error('Refresh failed', err);
              agentDebugLog('A2', 'auth.refreshUserContext', 'refresh-error', {
                status: (err as HttpErrorResponse)?.status ?? null,
                sentRefreshToken,
                willClear: isHttpAuthFailure(err) && sentRefreshToken,
              });
              if (isHttpAuthFailure(err) && sentRefreshToken) {
                this.clearUser();
                if (redirectOnFailure) {
                  void this.router.navigate(['/login']);
                }
              }
              return of(null);
            }),
            finalize(() => {
              if (role === 'leader') {
                releaseRefreshLeader(!!this.getUserSnapshot());
              }
            }),
          );
      }),
    );

    // Assign before subscribe so concurrent callers in the same tick join one stream.
    const shared$ = refresh$.pipe(
      finalize(() => {
        this.refreshShared$ = null;
      }),
      shareReplay(1),
    );
    this.refreshShared$ = shared$;
    return shared$;
  }

  /** After refresh, cookies hold the new JWT; keep local ctx if body omits user fields. */
  private resolveUserAfterRefresh(raw: unknown): UserContextModel | null {
    const normalized = normalizeUserContext(raw);
    if (normalized) return normalized;
    if (isRefreshSuccess(raw)) {
      this.hydrateSessionFromStorageIfNeeded();
      return this.getUserSnapshot();
    }
    return null;
  }

  logout(): Observable<void> {
    this.unregisterPushToken();
    const refreshToken = this.nativeAuthTokens.getRefreshToken();
    this.resetLocalStaffSessionData();
    this.clearUser();
    this.clearRestaurantCtx();
    const headers: Record<string, string> = {};
    if (this.nativeAuthTokens.isEnabled()) {
      headers[NATIVE_AUTH_HEADER] = '1';
    }
    const body = refreshToken ? { refreshToken } : {};
    return this.http.post<void>(`${this.apiUrl}/api/user/logout`, body, {
      withCredentials: true,
      headers,
    }).pipe(
      map(() => undefined as void),
      catchError(err => {
        console.warn('Logout API call failed; local session already cleared', err);
        return of(undefined as void);
      }),
    );
  }

  private unregisterPushToken(): void {
    try {
      void this.injector.get(PushRegistrationService).unregisterCurrentToken();
    } catch {
      // optional on web-only bundles
    }
  }

  private resetLocalStaffSessionData(): void {
    try {
      localStorage.removeItem('currentTableId');
      localStorage.removeItem('tableInitiatedByMap');
    } catch {
      // ignore
    }
    try {
      void this.injector.get(OfflineDbService).resetAllOfflineTenantData();
      void this.injector.get(OrdersService).clearInitiatedByCache();
    } catch {
      // ignore optional bundles
    }
  }


  deleteCookie(name: string, path: string = '/', domain?: string): void {
    let cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${path}`;
    if (domain) {
      cookie += `;domain=${domain}`;
    }
    document.cookie = cookie;
  }

}
