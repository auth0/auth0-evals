import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Auth0Provider
      domain="dev-barkbook.us.auth0.com"
      clientId="barkbook_client_abc123xyz"
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: 'https://api.barkbook.com',
      }}
    >
      <App />
    </Auth0Provider>
  </React.StrictMode>,
);
