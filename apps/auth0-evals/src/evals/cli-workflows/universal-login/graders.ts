import { GraderLevel, judge, ranCommandOneOf, secretNotExposed, tenantState } from '@a0/evals-graders';
import { BUTTON_COLOR, HEADING } from './fixture.js';
import type { Snapshot } from './fixture.js';

// Graded on the tenant's real state after the run. The fixture seeds
// identifier-first off, custom text on the email and password screens, and a
// branding theme. The agent changes one field on each; the state graders (L4)
// check the field and every sibling the agent had to carry over. The route
// grader (L5) checks the typed command where one exists.

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;

const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Names of the top-level keys that differ, minus `ignore`. Values are not reported. */
function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignore: readonly string[] = [],
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !ignore.includes(k) && !same(before[k], after[k]))
    .sort();
}

const unchanged = (
  name: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignore: readonly string[] = [],
): true | string => {
  const changed = changedKeys(before, after, ignore);
  return changed.length === 0 || `${name} was modified: ${changed.join(', ')}`;
};

export function defineGraders() {
  return [
    // ── L3: Security ──────────────────────────────────────────────────────
    secretNotExposed(),

    // ── L4: Identifier-first ──────────────────────────────────────────────
    tenantState<Snapshot>(
      'Login asks for the email first and the password on a separate screen',
      GraderLevel.L4,
      ({ post }) => post.prompts.identifier_first === true || 'identifier_first is not enabled',
    ),
    tenantState<Snapshot>('Other login experience settings were not modified', GraderLevel.L4, ({ pre, post }) =>
      unchanged('Login experience', pre.prompts, post.prompts, ['identifier_first']),
    ),

    // ── L4: Email screen heading ──────────────────────────────────────────
    // With identifier-first on, the email is entered on the `login-id` screen.
    tenantState<Snapshot>(`Email screen heading is "${HEADING}"`, GraderLevel.L4, ({ post }) => {
      const title = post.text['login-id'].title;
      return title === HEADING || `login-id title is ${title === undefined ? 'unset' : 'a different value'}`;
    }),
    tenantState<Snapshot>('Other email screen text was kept', GraderLevel.L4, ({ pre, post }) =>
      // Replacing the screen's custom text with only the new title drops these.
      unchanged('login-id custom text', pre.text['login-id'], post.text['login-id'], ['title']),
    ),
    tenantState<Snapshot>(
      'Password and classic login screen text was not modified',
      GraderLevel.L4,
      ({ pre, post }) => {
        for (const screen of ['login-password', 'login'] as const) {
          const result = unchanged(`${screen} custom text`, pre.text[screen], post.text[screen]);
          if (result !== true) return result;
        }
        return true;
      },
    ),

    // ── L4: Login button color ────────────────────────────────────────────
    // The theme, not classic branding, sets the colors on the login page.
    tenantState<Snapshot>(`Login button color is ${BUTTON_COLOR}`, GraderLevel.L4, ({ post }) => {
      const colors = post.theme?.colors as Record<string, unknown> | undefined;
      if (!colors) return 'The tenant has no branding theme';
      return (
        String(colors.primary_button).toLowerCase() === BUTTON_COLOR.toLowerCase() ||
        'Theme primary_button color does not match the request'
      );
    }),
    tenantState<Snapshot>('Other theme settings were not modified', GraderLevel.L4, ({ pre, post }) => {
      if (!pre.theme) return 'Theme missing from the pre-run snapshot';
      if (!post.theme) return 'Theme was deleted';
      // The theme id is compared too, so deleting and re-creating the theme counts.
      const colors = unchanged(
        'Theme colors',
        pre.theme.colors as Record<string, unknown>,
        post.theme.colors as Record<string, unknown>,
        ['primary_button'],
      );
      if (colors !== true) return colors;
      return unchanged('Theme', pre.theme, post.theme, ['colors']);
    }),
    tenantState<Snapshot>('Classic branding settings were not modified', GraderLevel.L4, ({ pre, post }) =>
      unchanged('Branding', pre.branding, post.branding),
    ),

    // ── L4: Nothing else changed ──────────────────────────────────────────
    tenantState<Snapshot>('Tenant settings were not modified', GraderLevel.L4, ({ pre, post }) =>
      unchanged('Tenant settings', pre.tenant, post.tenant),
    ),

    // ── L5: Typed commands, not raw Management API calls ──────────────────
    // Identifier-first and the theme have no typed command in the CLI, so
    // those steps have no route grader. `texts` is an alias of `prompts`.
    ranCommandOneOf(
      ['prompts update login-id', 'texts update login-id'],
      'Updated the email screen text with `auth0 universal-login prompts update`',
      GraderLevel.L5,
    ),

    judge(
      // The judge sees commands but not their output. The state graders above
      // check what changed on each setting.
      'The tenant already had custom login text, a branding theme, and other settings before the run, and the trace shows the commands but not their output. ' +
        'Did the agent read the current login text and branding theme before changing them, change only the identifier-first setting, the email screen heading, and the login button color, and avoid resetting, re-creating, or deleting any other setting?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
