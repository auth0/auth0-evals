export default {
  listActions(ctx) {
    if (!ctx.state.has('cte.action')) return { actions: [] };
    return { actions: [{ id: 'act_cte_validator', name: 'cte-validator', deployed: ctx.state.has('cte.deployed'), supported_triggers: [{ id: 'custom-token-exchange', version: 'v1' }] }] };
  },
};
