import { HttpInterceptorFn, HttpErrorResponse, HttpContextToken } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService, isHttpAuthFailure } from '../auth/auth.service';
import { NativeAuthTokenService } from '../auth/native-auth-token.service';
import { Router } from '@angular/router';
import { SseConnectivityService } from '../offline/sse-connectivity.service';
import { logConnectivityHttpFailure } from '../offline/connectivity-debug.logger';
import { catchError, switchMap, throwError, timeout } from 'rxjs';

const REFRESH_TIMEOUT_MS = 15_000;

/** Set on a retried request so a second 401 does not trigger another refresh loop. */
export const AUTH_RETRIED = new HttpContextToken<boolean>(() => false);

/** Background lock/status polls must not flip global offline on transient status=0. */
export const SKIP_CONNECTIVITY_OFFLINE = new HttpContextToken<boolean>(() => false);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const sseConnectivity = inject(SseConnectivityService);
  const nativeAuthTokens = inject(NativeAuthTokenService);

  const isPublic = req.url.includes('/public/');
  const isRefresh = req.url.includes('/refresh-token');
  const isLogin = req.url.includes('/login');

  const withAuthHeaders = (base: typeof req, retried: boolean) =>
    base.clone({
      context: base.context.set(AUTH_RETRIED, retried),
      withCredentials: true,
      setHeaders: nativeAuthTokens.authHeaders(),
    });

  const request = withAuthHeaders(req, false);

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (isRefresh || isLogin) {
        return throwError(() => error);
      }

      if (error.status === 0) {
        const skipOffline = req.context.get(SKIP_CONNECTIVITY_OFFLINE);
        if (!skipOffline) {
          logConnectivityHttpFailure(req.url, 'H3');
          sseConnectivity.reportHttpNetworkFailure();
        } else {
          logConnectivityHttpFailure(req.url, 'H5');
        }
        return throwError(() => error);
      }

      if (error.status === 401 && !isPublic) {
        if (req.context.get(AUTH_RETRIED)) {
          auth.clearUser();
          router.navigate(['/login']);
          return throwError(() => error);
        }
        sseConnectivity.reportStreamActivity('http-401');
        auth.hydrateSessionFromStorageIfNeeded();
        let attemptedRetry = false;
        return auth.refreshUserContext({ redirectOnFailure: false }).pipe(
          timeout({ first: REFRESH_TIMEOUT_MS }),
          switchMap((user) => {
            auth.hydrateSessionFromStorageIfNeeded();
            const sessionOk = user != null || auth.isAuthenticated();
            if (!sessionOk) {
              return throwError(() => error);
            }
            attemptedRetry = true;
            return next(withAuthHeaders(req, true));
          }),
          catchError(err => {
            if (isHttpAuthFailure(err)) {
              auth.clearUser();
              router.navigate(['/login']);
            }
            return throwError(() => err);
          })
        );
      }

      return throwError(() => error);
    })
  );
};
