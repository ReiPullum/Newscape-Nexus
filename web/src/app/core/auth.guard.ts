import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  const refreshed = await auth.tryRefresh();
  if (refreshed) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};
