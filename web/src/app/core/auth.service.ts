import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map, tap } from 'rxjs';
import { finalize } from 'rxjs/operators';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiBase = 'http://localhost:3000/api/auth';
  private readonly accessTokenKey = 'ns_access_token';

  readonly user = signal<AuthUser | null>(null);
  readonly loading = signal(false);

  constructor(private http: HttpClient) {
    this.restoreSession();
  }

  get accessToken(): string | null {
    return localStorage.getItem(this.accessTokenKey);
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  async restoreSession(): Promise<void> {
    if (!this.accessToken) {
      return;
    }

    try {
      const me = await firstValueFrom(this.http.get<AuthUser>(`${this.apiBase}/me`, { withCredentials: true }));
      this.user.set(me);
    } catch {
      const refreshed = await this.tryRefresh();
      if (!refreshed) {
        this.clearSession();
      }
    }
  }

  login(username: string, password: string) {
    this.loading.set(true);
    return this.http.post<LoginResponse>(
      `${this.apiBase}/login`,
      { username, password },
      { withCredentials: true }
    ).pipe(
      tap((res) => {
        this.setAccessToken(res.accessToken);
        this.user.set(res.user);
      }),
      finalize(() => this.loading.set(false)),
      map((res) => res.user)
    );
  }

  logout() {
    return this.http.post<void>(`${this.apiBase}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => this.clearSession())
    );
  }

  async tryRefresh(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ accessToken: string }>(`${this.apiBase}/refresh`, {}, { withCredentials: true })
      );
      this.setAccessToken(res.accessToken);

      const me = await firstValueFrom(this.http.get<AuthUser>(`${this.apiBase}/me`, { withCredentials: true }));
      this.user.set(me);
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  setAccessToken(token: string) {
    localStorage.setItem(this.accessTokenKey, token);
  }

  clearSession() {
    localStorage.removeItem(this.accessTokenKey);
    this.user.set(null);
    this.loading.set(false);
  }
}
