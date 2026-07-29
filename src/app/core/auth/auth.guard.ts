// auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { agentDebugLog } from '../debug/agent-debug.logger';

export const AuthGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  agentDebugLog('A1', 'auth.guard', 'canActivate-enter', {
    url: state.url,
    isAuthenticated: authService.isAuthenticated(),
    role: authService.getUserRole(),
  });

  if (!authService.isAuthenticated()) {
    agentDebugLog('A1', 'auth.guard', 'redirect-not-authenticated', { url: state.url });
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url }
    });
  }

  return authService.pingSession(false).pipe(
    tap(user => {
      agentDebugLog('A1', 'auth.guard', 'pingSession-result', {
        url: state.url,
        pingUserId: user?.id ?? null,
        pingRole: user?.role ?? null,
      });
    }),
    map(user => {
      if (!user) {
        agentDebugLog('A1', 'auth.guard', 'logout-ping-null', { url: state.url });
        authService.clearUser();
        authService.clearRestaurantCtx();
        return router.createUrlTree(['/login'], {
          queryParams: { returnUrl: state.url }
        });
      }
      return true;
    })
  );
};
