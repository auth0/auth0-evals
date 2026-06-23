import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <main class="page">
      <h1>Profile</h1>

      @if (user$ | async; as user) {
        <section class="card">
          @if (user.picture; as picture) {
            <img [src]="picture" [alt]="(user.name || 'User') + ' avatar'" />
          }

          <div>
            <h2>{{ user.name || user.nickname || 'Authenticated User' }}</h2>
            <p>{{ user.email || 'No email claim available' }}</p>
          </div>
        </section>
      }
    </main>
  `,
  styles: `
    .page {
      max-width: 48rem;
      margin: 0 auto;
      padding: 2rem 1.5rem 3rem;
    }

    .card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem;
      border: 1px solid #d9e2f2;
      border-radius: 1rem;
      background: #fff;
    }

    img {
      width: 4.5rem;
      height: 4.5rem;
      border-radius: 50%;
      object-fit: cover;
    }

    h2,
    p {
      margin: 0;
    }
  `,
})
export class ProfileComponent {
  private readonly auth = inject(AuthService);

  protected readonly user$ = this.auth.user$;
}
