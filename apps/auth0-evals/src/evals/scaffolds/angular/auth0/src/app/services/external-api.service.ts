import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';
import { switchMap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ExternalApiService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly apiAudience = 'https://api.barkbook.com';
  private readonly apiBaseUrl = 'https://api.barkbook.com';

  getAccessToken() {
    return this.auth.getAccessTokenSilently({
      authorizationParams: {
        audience: this.apiAudience,
      },
    });
  }

  callExternalApi(path = '/demo') {
    const url = `${this.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    return this.getAccessToken().pipe(
      switchMap((token) =>
        this.http.get<unknown>(url, {
          headers: new HttpHeaders({
            Authorization: `Bearer ${token}`,
          }),
        }),
      ),
    );
  }
}
