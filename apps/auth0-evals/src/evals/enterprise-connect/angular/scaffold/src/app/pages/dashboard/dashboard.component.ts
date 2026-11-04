import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppUser, SessionService } from '../../services/session.service';

@Component({
  selector: 'app-dashboard',
  template: `
    @if (user(); as user) {
      <main>
        <h1>Welcome, {{ user.name }}</h1>
        <p>{{ user.email }}</p>
        <button (click)="signOut()">Sign out</button>
      </main>
    } @else {
      <p>Loading…</p>
    }
  `,
})
export class DashboardComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  user = signal<AppUser | null>(null);

  ngOnInit(): void {
    this.session.fetchCurrentUser().subscribe((current) => {
      if (current) this.user.set(current);
      else this.router.navigate(['/signin'], { replaceUrl: true });
    });
  }

  signOut(): void {
    this.session.signOut().subscribe(() => this.router.navigate(['/signin']));
  }
}
