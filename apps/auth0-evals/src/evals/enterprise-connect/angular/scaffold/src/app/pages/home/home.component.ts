import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <main>
      <h1>Barkbook</h1>
      <a routerLink="/signin">Sign in</a> · <a routerLink="/dashboard">Dashboard</a>
    </main>
  `,
})
export class HomeComponent {}
