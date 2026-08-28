const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');

const app = express();
app.use(express.json());

const config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.AUTH0_SECRET,
  baseURL: process.env.AUTH0_BASE_URL,
  clientID: process.env.AUTH0_CLIENT_ID,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  authorizationParams: {
    response_type: 'code',
  },
  identityClaimFilter: ['aud', 'iss', 'iat', 'exp', 'nbf', 'nonce', 'azp', 'auth_time', 's_hash', 'at_hash', 'c_hash', 'amr', 'acr'],
};

app.use(auth(config));

app.get('/', (req, res) => {
  res.send(req.oidc.isAuthenticated() ? 'Logged in' : 'Logged out');
});

app.get('/profile', requiresAuth(), (req, res) => {
  res.json(req.oidc.user);
});

// Transfer funds route
app.post('/transfer', requiresAuth(), (req, res) => {
  res.json({ message: 'Transfer initiated', amount: req.body.amount });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
