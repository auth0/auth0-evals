import type { RuntimeContext, RuntimeOutcome } from '@a0/eval-graders';

/**
 * Drives a real Auth0 Universal Login against the test tenant and asserts the
 * app reaches a logged-in state showing the user's name.
 *
 * Selectors for Auth0's Universal Login page are intentionally kept here (per
 * eval), not framework-baked, so they are easy to update if the login page
 * markup changes. App selectors use the data-testids mandated by PROMPT.md.
 */
export default async function run({ page, baseURL, testUser }: RuntimeContext): Promise<RuntimeOutcome> {
  await page.goto(baseURL, { waitUntil: 'networkidle' });

  const loginButton = page.getByTestId('login');
  await loginButton.click();

  // Auth0 Universal Login (new identifier-first or classic login form).
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="username"]', testUser.email);

  // Some Universal Login flows split username/password across steps.
  const passwordField = page.locator('input[name="password"]');
  if ((await passwordField.count()) === 0) {
    await page
      .getByRole('button', { name: /continue|next/i })
      .first()
      .click();
    await page.waitForSelector('input[name="password"]');
  }
  await page.fill('input[name="password"]', testUser.password);
  await page
    .getByRole('button', { name: /continue|log ?in|sign ?in/i })
    .first()
    .click();

  // Back on the app after the redirect callback completes.
  await page.waitForURL(`${baseURL}/**`, { timeout: 30_000 });

  const profile = page.getByTestId('profile');
  await profile.waitFor({ state: 'visible', timeout: 15_000 });
  const text = (await profile.textContent()) ?? '';

  if (!text.includes(testUser.expectedName)) {
    return {
      passed: false,
      detail: `Logged in but profile did not show "${testUser.expectedName}" (saw: "${text.trim()}")`,
    };
  }
  return { passed: true, detail: `Logged in; profile shows "${testUser.expectedName}"` };
}
