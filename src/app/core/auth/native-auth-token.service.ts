import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PlatformStorageService } from '../platform/platform-storage.service';

/** Request native token fields in login/refresh responses (Capacitor only). */
export const NATIVE_AUTH_HEADER = 'X-URS-Native-Auth';

const ACCESS_TOKEN_KEY = 'NativeAuthAccessToken';
const REFRESH_TOKEN_KEY = 'NativeAuthRefreshToken';

@Injectable({ providedIn: 'root' })
export class NativeAuthTokenService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly storage: PlatformStorageService) {}

  /** Bearer tokens in app storage — Capacitor only. Web uses HttpOnly cookies. */
  isEnabled(): boolean {
    return Capacitor.isNativePlatform();
  }

  async initialize(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.loadFromStorage();
    }
    await this.initPromise;
  }

  /** Re-read tokens from storage (e.g. after another refresh rotated them). */
  async reloadFromStorage(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    await this.loadFromStorage();
  }

  /** True when the access JWT is present and not expired (with small clock skew). */
  isAccessTokenValid(skewSeconds = 60): boolean {
    const token = this.getAccessToken();
    if (!token) {
      return false;
    }
    const exp = readJwtExpSeconds(token);
    if (exp == null) {
      return false;
    }
    return exp * 1000 > Date.now() + skewSeconds * 1000;
  }

  getAccessToken(): string | null {
    return this.accessToken?.trim() || null;
  }

  getRefreshToken(): string | null {
    return this.normalizeRefreshToken(this.refreshToken);
  }

  /**
   * Web migration: leftover tab-scoped refresh token in sessionStorage.
   * Send once in refresh body (no native header) so the API can mint cookies.
   */
  takeWebLegacyRefreshToken(): string | null {
    if (this.isEnabled() || typeof sessionStorage === 'undefined') {
      return null;
    }
    try {
      const token = this.normalizeRefreshToken(sessionStorage.getItem(REFRESH_TOKEN_KEY));
      if (token) {
        sessionStorage.removeItem(REFRESH_TOKEN_KEY);
        sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      }
      return token;
    } catch {
      return null;
    }
  }

  authHeaders(): Record<string, string> {
    const token = this.getAccessToken();
    if (!token) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }

  captureFromAuthPayload(raw: unknown): void {
    if (!this.isEnabled() || !raw || typeof raw !== 'object') {
      return;
    }
    const r = raw as Record<string, unknown>;
    const access =
      (r['accessToken'] as string | undefined) ??
      (r['AccessToken'] as string | undefined) ??
      (r['bearerToken'] as string | undefined) ??
      (r['BearerToken'] as string | undefined);
    const refresh =
      (r['refreshToken'] as string | undefined) ??
      (r['RefreshToken'] as string | undefined) ??
      (r['newRefreshToken'] as string | undefined) ??
      (r['NewRefreshToken'] as string | undefined);

    if (access?.trim()) {
      this.accessToken = access.trim();
    }
    const normalizedRefresh = this.normalizeRefreshToken(refresh);
    if (normalizedRefresh) {
      this.refreshToken = normalizedRefresh;
    }
    if (access?.trim() || normalizedRefresh) {
      void this.persist();
    }
  }

  async clear(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    this.clearWebLegacySessionTokens();
    if (!this.isEnabled()) {
      return;
    }
    await this.storage.setString(ACCESS_TOKEN_KEY, '');
    await this.storage.setString(REFRESH_TOKEN_KEY, '');
  }

  private clearWebLegacySessionTokens(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    try {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // ignore
    }
  }

  private async loadFromStorage(): Promise<void> {
    const [access, refresh] = await Promise.all([
      this.storage.getString(ACCESS_TOKEN_KEY),
      this.storage.getString(REFRESH_TOKEN_KEY),
    ]);
    this.accessToken = access?.trim() || null;
    this.refreshToken = this.normalizeRefreshToken(refresh);
  }

  /** Cookie / persisted values may be URL-encoded (%24 → $); DB stores decoded bcrypt hash. */
  private normalizeRefreshToken(token: string | null | undefined): string | null {
    const trimmed = token?.trim();
    if (!trimmed) {
      return null;
    }
    if (!trimmed.includes('%')) {
      return trimmed;
    }
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }

  private async persist(): Promise<void> {
    if (this.accessToken) {
      await this.storage.setString(ACCESS_TOKEN_KEY, this.accessToken);
    } else {
      await this.storage.setString(ACCESS_TOKEN_KEY, '');
    }
    if (this.refreshToken) {
      await this.storage.setString(REFRESH_TOKEN_KEY, this.refreshToken);
    } else {
      await this.storage.setString(REFRESH_TOKEN_KEY, '');
    }
  }
}

function readJwtExpSeconds(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}
