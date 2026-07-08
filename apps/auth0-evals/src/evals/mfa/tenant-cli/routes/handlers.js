const FACTORS = [
  'sms',
  'push-notification',
  'otp',
  'email',
  'duo',
  'webauthn-roaming',
  'webauthn-platform',
  'recovery-code',
];

export default {
  setFactor(ctx) {
    const factor = ctx.path.split('/').pop();
    const disabled = /"enabled"\s*:\s*false/.test(ctx.payload);
    if (disabled) ctx.state.clear(`mfa.factor.${factor}`);
    else ctx.state.set(`mfa.factor.${factor}`);
    return { enabled: true };
  },
  listFactors(ctx) {
    return FACTORS.map((name) => ({ name, enabled: ctx.state.has(`mfa.factor.${name}`), trial_expired: false }));
  },
};
