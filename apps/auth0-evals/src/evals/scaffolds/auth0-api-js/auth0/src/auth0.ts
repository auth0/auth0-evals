import { ApiClient } from '@auth0/auth0-api-js';

export const apiClient = new ApiClient({
  domain: process.env.AUTH0_DOMAIN as string,
  audience: process.env.AUTH0_AUDIENCE as string,
});
