import cookieParser from 'cookie-parser';
import express from 'express';
import type { Request, Response } from 'express';
import { clearSession, createSession, requireSession } from './session.js';
import type { AppUser } from './session.js';
import { verifyPassword } from './users.js';
import { dashboardPage, signInPage } from './views.js';

const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

const app = express();

app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

app.get('/', (_request: Request, response: Response) => {
  response.redirect('/dashboard');
});

// Barkbook's existing email + password sign-in. `?email=` pre-fills the form.
app.get('/signin', (request: Request, response: Response) => {
  response.send(
    signInPage({
      email: typeof request.query.email === 'string' ? request.query.email : '',
      error: request.query.error ? 'Invalid email or password.' : undefined,
    }),
  );
});

app.post('/signin', (request: Request, response: Response) => {
  const user = verifyPassword(String(request.body.email ?? ''), String(request.body.password ?? ''));
  if (!user) {
    response.redirect('/signin?error=invalid');
    return;
  }
  createSession(response, user);
  response.redirect('/dashboard');
});

app.get('/dashboard', requireSession, (_request: Request, response: Response) => {
  const user = response.locals.user as AppUser;
  response.send(dashboardPage(user));
});

app.get('/signout', (_request: Request, response: Response) => {
  clearSession(response);
  response.redirect('/signin');
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Barkbook web listening on ${appBaseUrl}`);
});
