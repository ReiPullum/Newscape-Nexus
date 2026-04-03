import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="reset-password-container">
      <div class="reset-card">
        <h1>Reset Password</h1>

        <div *ngIf="error" class="error-message">
          {{ error }}
        </div>

        <div *ngIf="success" class="success-message">
          <p>{{ success }}</p>
          <a routerLink="/login" class="link">Return to login</a>
        </div>

        <form [formGroup]="resetForm" (ngSubmit)="onReset()" *ngIf="!success && !isExpired">
          <p class="info-text">
            <small>Enter a new password for your account.</small>
          </p>

          <div class="form-group">
            <label for="password">New Password</label>
            <input
              id="password"
              type="password"
              formControlName="password"
              placeholder="Enter new password"
              required
            />
            <small *ngIf="resetForm.get('password')?.hasError('required') && resetForm.get('password')?.touched"
              >Password is required</small
            >
            <small *ngIf="resetForm.get('password')?.hasError('minlength') && resetForm.get('password')?.touched"
              >Password must be at least 8 characters</small
            >
          </div>

          <div class="form-group">
            <label for="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              formControlName="confirmPassword"
              placeholder="Confirm new password"
              required
            />
            <small *ngIf="
              resetForm.get('confirmPassword')?.hasError('required') &&
              resetForm.get('confirmPassword')?.touched
            "
              >Confirm password is required</small
            >
            <small *ngIf="
              resetForm.get('confirmPassword')?.hasError('mismatch') &&
              resetForm.get('confirmPassword')?.touched
            "
              >Passwords do not match</small
            >
          </div>

          <button type="submit" [disabled]="resetForm.invalid || isLoading" class="btn-primary">
            {{ isLoading ? 'Resetting...' : 'Reset Password' }}
          </button>
        </form>

        <div *ngIf="isExpired" class="expired-message">
          <p>This reset link has expired or is invalid.</p>
          <a routerLink="/login" class="link">Request a new reset</a>
        </div>
      </div>
    </div>
  `,
  styles: `
    .reset-password-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .reset-card {
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
      margin-bottom: 1rem;
    }

    .expired-message {
      background: #fef3cd;
      color: #856404;
      padding: 1rem;
      border-radius: 4px;
      border-left: 4px solid #ffc107;
      text-align: center;
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
export class ResetPasswordComponent implements OnInit {
  resetForm!: FormGroup;
  isLoading = false;
  error: string | null = null;
  success: string | null = null;
  isExpired = false;
  token: string | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {
    this.resetForm = this.fb.group(
      {
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: this.passwordMatchValidator }
    );
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      this.isExpired = true;
    }
  }

  passwordMatchValidator(group: FormGroup): { [key: string]: any } | null {
    const password = group.get('password')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;

    if (password && confirmPassword && password !== confirmPassword) {
      group.get('confirmPassword')?.setErrors({ mismatch: true });
      return { mismatch: true };
    }

    const errors = group.get('confirmPassword')?.errors;
    if (errors) {
      delete errors['mismatch'];
      if (Object.keys(errors).length === 0) {
        group.get('confirmPassword')?.setErrors(null);
      }
    }

    return null;
  }

  onReset(): void {
    if (!this.token || this.resetForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.error = null;

    const newPassword = this.resetForm.get('password')?.value;

    this.http
      .post('/api/auth/password-reset/confirm', {
        token: this.token,
        newPassword,
      })
      .pipe(
        catchError((err) => {
          let message = 'Failed to reset password. Try requesting a new reset link.';
          if (err.status === 400) {
            message = err.error?.message || 'Invalid or expired reset token.';
          } else if (err.status === 409) {
            message = err.error?.message || 'Password was recently used. Choose a different password.';
          }
          this.error = message;
          this.isLoading = false;
          return of(null);
        })
      )
      .subscribe((result) => {
        if (result) {
          this.success = 'Password reset successfully! You can now log in with your new password.';
          this.resetForm.disable();
        }
      });
  }
}
