import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionService } from '../../services/session.service';

// Barkbook's existing email + password sign-in. `?email=` pre-fills the form.
@Component({
  selector: 'app-signin',
  imports: [FormsModule],
  template: `
    <main>
      <h1>Sign in to Barkbook</h1>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <form (ngSubmit)="submit()">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" [(ngModel)]="email" required />
        <label for="password">Password</label>
        <input type="password" id="password" name="password" [(ngModel)]="password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  `,
})
export class SignInComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  email = inject(ActivatedRoute).snapshot.queryParamMap.get('email') ?? '';
  password = '';
  error = signal<string | null>(null);

  submit(): void {
    this.session.signInWithPassword(this.email, this.password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: () => this.error.set('Invalid email or password.'),
    });
  }
}
