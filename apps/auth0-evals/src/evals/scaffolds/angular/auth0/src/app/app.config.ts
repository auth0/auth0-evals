import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAuth0 } from '@auth0/auth0-angular';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideAuth0({
      domain: 'dev-barkbook.us.auth0.com',
      clientId: 'barkbook_client_abc123xyz',
      authorizationParams: {
        redirect_uri: window.location.origin,
        audience: 'https://api.barkbook.com',
        scope: 'openid profile email',
      },
    }),
  ],
};
