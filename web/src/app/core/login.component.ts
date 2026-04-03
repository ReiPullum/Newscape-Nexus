import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="login-container">
      <section class="login-wrap">
        <h2>Sign in</h2>
        <p class="hint">Use your backend credentials to access the market dashboard.</p>

        <form (ngSubmit)="onSubmit()" class="login-form">
          <label>
            Username
            <input [(ngModel)]="username" name="username" required minlength="3" />
          </label>

          <label>
            Password
            <input [(ngModel)]="password" name="password" type="password" required minlength="8" />
          </label>

          <div class="forgot-link">
            <a routerLink="/forgot-password" class="link">Forgot your password?</a>
          </div>

          <button type="submit" [disabled]="submitting">{{ submitting ? 'Signing in...' : 'Sign in' }}</button>
        </form>

        <p *ngIf="error" class="error">{{ error }}</p>
        <p class="demo-note">Default dev login: admin / change-me-now</p>
      </section>
    </div>
  `,
  styles: [
    `
      .login-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }

      .login-wrap {
        width: 100%;
        max-width: 420px;
        padding: 2rem;
        border-radius: 0.8rem;
        background: white;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      }

      h2 {
        margin: 0 0 1rem;
        color: #333;
        font-size: 1.75rem;
      }

      .hint {
        color: #666;
        font-size: 0.95rem;
        margin-bottom: 1.5rem;
      }

      .login-form {
        display: grid;
        gap: 1rem;
      }

      label {
        display: grid;
        gap: 0.35rem;
        color: #555;
        font-weight: 600;
      }

      input {
        background: #f9f9f9;
        border: 1px solid #ddd;
        color: #333;
        padding: 0.75rem;
        border-radius: 0.4rem;
        font-size: 1rem;
        transition: border-color 0.3s;
      }

      input:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
      }

      .forgot-link {
        text-align: right;
        margin: 0.5rem 0;
      }

      .link {
        color: #667eea;
        text-decoration: none;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
      }

      .link:hover {
        text-decoration: underline;
      }

      button {
        margin-top: 0.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        padding: 0.75rem;
        border-radius: 0.45rem;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        font-size: 1rem;
      }

      button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
      }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .error {
        color: #e74c3c;
        margin-top: 1rem;
        padding: 0.75rem;
        background: #fee;
        border-radius: 0.4rem;
        border-left: 4px solid #e74c3c;
      }

      .demo-note {
        color: #999;
        font-size: 0.85rem;
        margin-top: 1rem;
        text-align: center;
      }
    `
  ]
})
export class LoginComponent {
  username = 'admin';
  password = 'change-me-now';
  error = '';
  submitting = false;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit() {
    this.error = '';
    this.submitting = true;

    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        this.submitting = false;
        this.router.navigate(['/market']);
      },
      error: () => {
        this.submitting = false;
        this.error = 'Login failed. Check your username and password.';
      }
    });
  }
}

