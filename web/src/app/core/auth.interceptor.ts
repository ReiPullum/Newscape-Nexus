import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  const isAuthRoute = req.url.includes('/api/auth/login') || req.url.includes('/api/auth/refresh');
  const accessToken = auth.accessToken;

  let nextReq = req;
  if (accessToken && !isAuthRoute) {
    nextReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${accessToken}`,
      },
      withCredentials: true,
    });
  } else if (req.url.includes('/api/auth')) {
    nextReq = req.clone({ withCredentials: true });
  }

  return next(nextReq).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || isAuthRoute) {
        return throwError(() => err);
      }

      return from(auth.tryRefresh()).pipe(
        switchMap((ok) => {
          if (!ok || !auth.accessToken) {
            return throwError(() => err);
          }

          const retried = req.clone({
            setHeaders: {
              Authorization: `Bearer ${auth.accessToken}`,
            },
            withCredentials: true,
          });

          return next(retried);
        })
      );
    })
  );
};
