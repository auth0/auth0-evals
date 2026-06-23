import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '@auth0/auth0-angular';
import { ExternalApiService } from '../../services/external-api.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <main class="page">
      <h1>Barkbook</h1>
      <p>Auth0 is configured with redirect login, route protection, and an API access token flow.</p>

      <section class="panel">
        <h2>Session</h2>
        <p>
          Status:
          <strong>{{ (isAuthenticated$ | async) ? 'Authenticated' : 'Signed out' }}</strong>
        </p>

        @if (isAuthenticated$ | async) {
          <div class="actions">
            <button type="button" (click)="loadAccessToken()">Get Access Token</button>
            <button type="button" (click)="callApi()">Call External API</button>
          </div>
        } @else {
          <p>Log in to request an access token and call the external API.</p>
        }
      </section>

      @if (accessToken) {
        <section class="panel">
          <h2>Access Token</h2>
          <pre>{{ accessToken }}</pre>
        </section>
      }

      @if (apiResponse) {
        <section class="panel">
          <h2>API Response</h2>
          <pre>{{ apiResponse }}</pre>
        </section>
      }

      @if (errorMessage) {
        <section class="panel error">
          <h2>Request Error</h2>
          <pre>{{ errorMessage }}</pre>
        </section>
      }
    </main>
  `,
  styles: `
    .page {
      max-width: 56rem;
      margin: 0 auto;
      padding: 2rem 1.5rem 3rem;
      display: grid;
      gap: 1rem;
    }

    .panel {
      padding: 1.25rem;
      border: 1px solid #d9e2f2;
      border-radius: 1rem;
      background: #fff;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1rem;
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

    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .error {
      border-color: #f1b6b6;
      background: #fff6f6;
    }
  `,
})
export class HomeComponent {
  private readonly auth = inject(AuthService);
  private readonly externalApi = inject(ExternalApiService);

  protected readonly isAuthenticated$ = this.auth.isAuthenticated$;

  protected accessToken = '';
  protected apiResponse = '';
  protected errorMessage = '';

  protected async loadAccessToken(): Promise<void> {
    this.errorMessage = '';

    try {
      this.accessToken = await firstValueFrom(this.externalApi.getAccessToken());
    } catch (error) {
      this.accessToken = '';
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  protected async callApi(): Promise<void> {
    this.errorMessage = '';

    try {
      const response = await firstValueFrom(this.externalApi.callExternalApi());
      this.apiResponse = JSON.stringify(response, null, 2);
    } catch (error) {
      this.apiResponse = '';
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'The request failed.';
  }
}
