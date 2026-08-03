import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/** Allows manager recipes/gestiune routes only when InventoryManagementEnabled is on. */
export const inventoryManagementGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const snap = auth.getUserSnapshot();
  if (snap?.inventoryManagementEnabled) {
    return true;
  }
  return auth.pingSession(false).pipe(
    map((user) => {
      if (user?.inventoryManagementEnabled) {
        return true;
      }
      return router.createUrlTree(['/manager/dashboard']);
    }),
  );
};
