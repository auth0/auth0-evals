// @ts-check

// Re-exports the shared monorepo base config (see /eslint.config.base.mjs) so
// `eslint .` in this workspace resolves the same rules as every other package.
export { default } from '../../eslint.config.base.mjs';
