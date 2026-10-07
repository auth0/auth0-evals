import { defineFixture } from '@a0/evals-graders';
import type { ManagementApi } from '@a0/evals-graders';

// Universal Login settings are tenant-wide, so nothing here is run-owned. Seed
// saves every value the run could touch, writes known starting values, and
// cleanup puts the saved values back. On CI each job gets a throwaway tenant;
// locally the restore keeps the dev tenant as it was.
//
// Starting state: identifier-first off, custom text on the email and password
// screens, and a branding theme. The task changes one field on each; the
// graders check that every sibling field survived.

export const HEADING = 'Sign in to Acme';
export const BUTTON_COLOR = '#0B5FFF';

/** Custom text the agent must keep. Only the email screen title is meant to change. */
export const LOGIN_ID_TEXT = {
  title: 'Welcome',
  description: 'Log in to the Acme Supplier Network to continue.',
  buttonText: 'Continue',
  footerText: 'New to Acme?',
  footerLinkText: 'Request access',
};
export const LOGIN_PASSWORD_TEXT = {
  title: 'Enter your password',
  description: 'Enter your Acme password to continue.',
};

/** Screens whose custom text is snapshotted. `login` is the screen used without identifier-first. */
export const SCREENS = ['login-id', 'login-password', 'login'] as const;
export type Screen = (typeof SCREENS)[number];

// A complete theme body; the themes API rejects a PATCH missing any section.
const THEME = {
  displayName: 'Acme',
  borders: {
    button_border_radius: 3,
    button_border_weight: 1,
    buttons_style: 'rounded',
    input_border_radius: 3,
    input_border_weight: 1,
    inputs_style: 'rounded',
    show_widget_shadow: true,
    widget_border_weight: 0,
    widget_corner_radius: 5,
  },
  colors: {
    base_focus_color: '#635dff',
    base_hover_color: '#000000',
    body_text: '#1e212a',
    error: '#d03c38',
    header: '#1e212a',
    icons: '#65676e',
    input_background: '#ffffff',
    input_border: '#c9cace',
    input_filled_text: '#000001',
    input_labels_placeholders: '#65676e',
    links_focused_components: '#635dff',
    primary_button: '#1f2937',
    primary_button_label: '#ffffff',
    secondary_button_border: '#c9cace',
    secondary_button_label: '#1e212a',
    success: '#13a688',
    widget_background: '#ffffff',
    widget_border: '#c9cace',
  },
  fonts: {
    body_text: { bold: false, size: 87.5 },
    buttons_text: { bold: false, size: 100 },
    font_url: '',
    input_labels: { bold: false, size: 100 },
    links: { bold: true, size: 87.5 },
    links_style: 'normal',
    reference_text_size: 16,
    subtitle: { bold: false, size: 87.5 },
    title: { bold: false, size: 150 },
  },
  page_background: { background_color: '#f4f4f8', background_image_url: '', page_layout: 'center' },
  widget: {
    header_text_alignment: 'center',
    logo_height: 52,
    logo_position: 'center',
    logo_url: '',
    social_buttons_layout: 'bottom',
  },
};

/** Tenant settings fields cleanup puts back if the run changed them. */
const TENANT_FIELDS = [
  'friendly_name',
  'picture_url',
  'support_email',
  'support_url',
  'session_lifetime',
  'idle_session_lifetime',
] as const;

const BRANDING_FIELDS = ['colors', 'logo_url', 'favicon_url', 'font'] as const;

export interface Snapshot {
  /** `universal_login_experience`, `identifier_first`, `webauthn_platform_first_factor`. */
  prompts: Record<string, unknown>;
  /** English custom text per screen, unwrapped from the `{ "<screen>": {...} }` envelope. */
  text: Record<Screen, Record<string, string>>;
  /** The default branding theme, or null when there is none. */
  theme: Record<string, unknown> | null;
  /** Classic branding (`/branding`), which the theme overrides on the login page. */
  branding: Record<string, unknown>;
  /** Tenant settings, without `universal_login`, which mirrors `/branding` colors. */
  tenant: Record<string, unknown>;
}

interface Saved {
  prompts: Record<string, unknown>;
  text: Record<Screen, Record<string, string>>;
  /** The original theme without its id, or null when the tenant had none. */
  theme: Record<string, unknown> | null;
  branding: Record<string, unknown>;
  tenant: Record<string, unknown>;
}

async function readText(mgmt: ManagementApi, screen: Screen): Promise<Record<string, string>> {
  const res = await mgmt.get<Record<string, Record<string, string>>>(`prompts/${screen}/custom-text/en`);
  return res[screen] ?? {};
}

const putText = (mgmt: ManagementApi, screen: Screen, text: Record<string, string>) =>
  mgmt.put(`prompts/${screen}/custom-text/en`, Object.keys(text).length > 0 ? { [screen]: text } : {});

/** The default theme, or null when the tenant has none (the API answers 404). */
async function readTheme(mgmt: ManagementApi): Promise<Record<string, unknown> | null> {
  return mgmt.get<Record<string, unknown>>('branding/themes/default').catch((e: unknown) => {
    if (String(e).includes('404')) return null;
    throw e;
  });
}

const pick = (obj: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

async function restore(mgmt: ManagementApi, saved: Saved): Promise<void> {
  // Each step is attempted even if another fails, so one bad write does not
  // leave the rest of the tenant changed.
  const steps: Array<() => Promise<unknown>> = [
    () => mgmt.patch('prompts', saved.prompts),
    ...SCREENS.map((s) => () => putText(mgmt, s, saved.text[s])),
    async () => {
      const current = await readTheme(mgmt);
      if (saved.theme) {
        const body = { ...saved.theme };
        delete body.themeId;
        // The agent may have deleted and re-created the theme, so target whatever is there now.
        if (current) await mgmt.patch(`branding/themes/${String(current.themeId)}`, body);
        else await mgmt.post('branding/themes', body);
      } else if (current) {
        await mgmt.delete(`branding/themes/${String(current.themeId)}`);
      }
    },
    () => mgmt.patch('branding', saved.branding),
    () => mgmt.patch('tenants/settings', saved.tenant),
  ];
  const results = await Promise.allSettled(steps.map((s) => s()));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) throw new Error(`${failed} restore writes failed`);
}

export default defineFixture({
  async seed({ mgmt }) {
    // Read everything before writing anything, so a failed write can be undone.
    const theme = await readTheme(mgmt);
    const saved: Saved = {
      prompts: pick(await mgmt.get<Record<string, unknown>>('prompts'), [
        'universal_login_experience',
        'identifier_first',
        'webauthn_platform_first_factor',
      ]),
      text: {
        'login-id': await readText(mgmt, 'login-id'),
        'login-password': await readText(mgmt, 'login-password'),
        login: await readText(mgmt, 'login'),
      },
      theme,
      branding: pick(await mgmt.get<Record<string, unknown>>('branding'), BRANDING_FIELDS),
      tenant: pick(await mgmt.get<Record<string, unknown>>('tenants/settings'), TENANT_FIELDS),
    };

    try {
      await mgmt.patch('prompts', { universal_login_experience: 'new', identifier_first: false });
      await putText(mgmt, 'login-id', LOGIN_ID_TEXT);
      await putText(mgmt, 'login-password', LOGIN_PASSWORD_TEXT);
      const seeded = theme
        ? await mgmt.patch<Record<string, unknown>>(`branding/themes/${String(theme.themeId)}`, THEME)
        : await mgmt.post<Record<string, unknown>>('branding/themes', THEME);
      return { saved, themeId: String(seeded.themeId) };
    } catch (e) {
      // Cleanup only sees `seeded` when seed returns, so undo here.
      await restore(mgmt, saved).catch(() => undefined);
      throw e;
    }
  },

  async snapshot({ mgmt }) {
    const tenant = await mgmt.get<Record<string, unknown>>('tenants/settings');
    delete tenant.universal_login;
    return {
      prompts: await mgmt.get<Record<string, unknown>>('prompts'),
      text: {
        'login-id': await readText(mgmt, 'login-id'),
        'login-password': await readText(mgmt, 'login-password'),
        login: await readText(mgmt, 'login'),
      },
      theme: await readTheme(mgmt),
      branding: await mgmt.get<Record<string, unknown>>('branding'),
      tenant,
    } satisfies Snapshot;
  },

  async cleanup({ mgmt, seeded }) {
    if (seeded.saved) await restore(mgmt, seeded.saved as Saved);
  },
});
