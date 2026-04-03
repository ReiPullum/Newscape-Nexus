import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="forgot-password-container">
      <div class="forgot-card">
        <h1>Reset Password</h1>

        <div *ngIf="error" class="error-message">
          {{ error }}
        </div>

        <div *ngIf="success" class="success-message">
          <p>{{ success }}</p>
          <p class="extra-info">Check your email for a password reset link. The link will expire in 1 hour.</p>
          <a routerLink="/login" class="link">Return to login</a>
        </div>

        <form [formGroup]="resetRequestForm" (ngSubmit)="onRequestReset()" *ngIf="!success">
          <p class="info-text">
            <small>Enter your email address and we'll send you a link to reset your password.</small>
          </p>

          <div class="form-group">
            <label for="email">Email Address</label>
            <input
              id="email"
              type="email"
              formControlName="email"
              placeholder="your@email.com"
              required
            />
            <small *ngIf="resetRequestForm.get('email')?.hasError('required') && resetRequestForm.get('email')?.touched"
              >Email is required</small
            >
            <small *ngIf="resetRequestForm.get('email')?.hasError('email') && resetRequestForm.get('email')?.touched"
              >Enter a valid email address</small
            >
          </div>

          <button type="submit" [disabled]="resetRequestForm.invalid || isLoading" class="btn-primary">
            {{ isLoading ? 'Sending...' : 'Send Reset Link' }}
          </button>

          <p class="login-link">
            Remember your password? <a routerLink="/login" class="link">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  `,
  styles: `
    .forgot-password-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .forgot-card {
      background: white;
      border-radius: 8px;
      padding: 2rem;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      width: 100%;
      max-width: 400px;
    }

    h1 {
      color: #333;
      margin-bottom: 1.5rem;
      text-align: center;
      font-size: 1.75rem;
    }

    .form-group {
      margin-bottom: 1.5rem;
    }

    label {
      display: block;
      color: #555;
      font-weight: 600;
      margin-bottom: 0.5rem;
      font-size: 0.9rem;
    }

    input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
      box-sizing: border-box;
      transition: border-color 0.3s;
    }

    input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    input:disabled {
      background-color: #f5f5f5;
      cursor: not-allowed;
    }

    small {
      display: block;
      color: #e74c3c;
      font-size: 0.85rem;
      margin-top: 0.35rem;
    }

    .info-text {
      color: #666;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
      text-align: center;
    }

    .btn-primary {
      width: 100%;
      padding: 0.75rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .btn-primary:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
    }

    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .error-message {
      background: #fee;
      color: #c33;
      padding: 1rem;
      border-radius: 4px;
      margin-bottom: 1.5rem;
      border-left: 4px solid #c33;
    }

    .success-message {
      background: #efe;
      color: #3c3;
      padding: 1rem;
      border-radius: 4px;
      margin-bottom: 1.5rem;
      border-left: 4px solid #3c3;
      text-align: center;
    }

    .success-message p {
      margin-bottom: 0.5rem;
    }

    .extra-info {
      font-size: 0.85rem;
      color: #2a8a2a !important;
      margin-bottom: 1rem !important;
    }

    .login-link {
      text-align: center;
      margin-top: 1.5rem;
      color: #666;
      font-size: 0.9rem;
    }

    .link {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      cursor: pointer;
    }

    .link:hover {
      text-decoration: underline;
    }
  `,
})
export class ForgotPasswordComponent {
  resetRequestForm: FormGroup;
  isLoading = false;
  error: string | null = null;
  success: string | null = null;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient
  ) {
    this.resetRequestForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  onRequestReset(): void {
    if (this.resetRequestForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.error = null;

    const email = this.resetRequestForm.get('email')?.value;

    this.http
      .post('/api/auth/password-reset/request', { email })
      .pipe(
        catchError((err) => {
          let message = 'Failed to send reset link. Please try again.';
          if (err.status === 404) {
            message = 'No account found with this email address.';
          } else if (err.status === 429) {
            message = 'Too many reset requests. Please try again later.';
          }
          this.error = message;
          this.isLoading = false;
          return of(null);
        })
      )
      .subscribe((result) => {
        if (result) {
          this.success = 'Password reset link sent to ' + email;
          this.resetRequestForm.disable();
        }
      });
  }
}
