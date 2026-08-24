const express = require('express');
const { auth, requiredScopes } = require('express-oauth2-jwt-bearer');

const app = express();
app.use(express.json());

// Validates JWT access tokens. The issuer and audience are read from the
// ISSUER_BASE_URL and AUDIENCE environment variables.
const checkJwt = auth();

app.get('/api/balance', checkJwt, requiredScopes('read:balance'), (req, res) => {
  res.json({ balance: 4200, sub: req.auth.payload.sub });
});

app.post('/api/transfers', checkJwt, requiredScopes('write:transfers'), (req, res) => {
  res.status(201).json({ transferred: req.body.amount, sub: req.auth.payload.sub });
});

// RFC 6750 error responses: the SDK sets err.status and err.code.
app.use((err, req, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  next(err);
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
