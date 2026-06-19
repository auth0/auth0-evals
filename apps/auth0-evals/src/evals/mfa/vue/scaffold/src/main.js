import { createApp } from 'vue';
import { createAuth0 } from '@auth0/auth0-vue';
import App from './App.vue';
import router from './router/index.js';

const app = createApp(App);

app.use(router);

app.use(
  createAuth0({
    domain: 'dev-barkbook.us.auth0.com',
    clientId: 'barkbook_client_abc123xyz',
    authorizationParams: {
      redirect_uri: window.location.origin,
      audience: 'https://api.barkbook.com',
    },
  }),
);

app.mount('#app');
