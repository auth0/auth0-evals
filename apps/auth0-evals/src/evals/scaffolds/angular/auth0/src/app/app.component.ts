import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterOutlet, RouterLink } from '@angular/router';
import { AuthService } from '@auth0/auth0-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterOutlet, RouterLink],
  template: `
    <nav class="shell-nav">
      <div class="shell-links">
        <a routerLink="/">Home</a>
        <a routerLink="/profile">Profile</a>
      </div>

      <div class="shell-auth">
        @if (user$ | async; as user) {
          <div class="user-chip">
            @if (user.picture; as picture) {
              <img [src]="picture" [alt]="(user.name || 'User') + ' avatar'" />
            }
            <span>{{ user.name || user.nickname || user.email }}</span>
          </div>
        }

        @if (isAuthenticated$ | async) {
          <button type="button" (click)="logout()">Log out</button>
        } @else {
          <button type="button" (click)="login()">Log in</button>
        }
      </div>
    </nav>

    <router-outlet />
  `,
  styles: `
    :host {
      display: block;
      font-family: Arial, sans-serif;
      color: #172033;
    }

    .shell-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid #d9e2f2;
      background: #f7f9fc;
    }

    .shell-links,
    .shell-auth {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .shell-links a {
      color: #1142a6;
      text-decoration: none;
      font-weight: 600;
    }

    .user-chip {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      border-radius: 999px;
      background: #e9f0ff;
    }

    .user-chip img {
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      object-fit: cover;
    }

    button {
      border: 0;
      border-radius: 999px;
      padding: 0.65rem 1rem;
      background: #1142a6;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
  `,
})
export class AppComponent {
  private readonly auth = inject(AuthService);

  protected readonly isAuthenticated$ = this.auth.isAuthenticated$;
  protected readonly user$ = this.auth.user$;

  protected login(): void {
    void firstValueFrom(this.auth.loginWithRedirect());
  }

  protected logout(): void {
    void firstValueFrom(
      this.auth.logout({
        logoutParams: {
          returnTo: window.location.origin,
        },
      }),
    );
  }
}
