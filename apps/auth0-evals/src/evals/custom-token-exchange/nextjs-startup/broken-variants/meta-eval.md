# Meta-eval: Custom Token Exchange × Next.js (Startup)

Verifies that graders correctly discriminate against broken implementations.
Each variant must fail at the indicated level — if any pass, tighten the grader.

| Variant | What's broken | Expected failure |
|---------|--------------|-----------------|
| `wrong-abstraction.md` | Uses `auth0.getAccessToken()` instead of `auth0.customTokenExchange()`; no `CustomTokenExchangeError` | L1: `customTokenExchange` and `CustomTokenExchangeError` contains() both fail |
| `code-only-no-config.md` | Correct SDK code; no token exchange profile created via CLI | L4: `ranCommand('/api/v2/token-exchange-profiles')` fails |
| `config-only-no-handler.md` | CLI configures profile correctly; code never calls `customTokenExchange()` | L1: `customTokenExchange` contains() fails |
| `consistency-mismatch.md` | Code uses `urn:nexuspay:legacy-token-v2`; CLI uses `urn:nexuspay:legacy-token` | L5: consistency judge fails |

## META-EVAL GATE: custom-token-exchange × nextjs-startup

```
✅ wrong-abstraction: L1 rejects (customTokenExchange absent)
✅ code-only-no-config: L4 rejects (ranCommand absent)
✅ config-only-no-handler: L1 rejects (customTokenExchange absent)
✅ consistency-mismatch: L5 rejects (token type mismatch)

STATUS: READY TO MERGE
```
