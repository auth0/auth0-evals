# @a0/evals-reporter

Report generation and analytics for the Auth0 eval framework. Turns the JSON score files produced by `a0-eval` into a self-contained HTML report, and provides the processing helpers used to group and diff results.

Part of the [`auth0-evals`](https://github.com/auth0/auth0-evals) monorepo.

## What it provides

- **`renderHtml(results, generatedAt)`** — render a full HTML report from an array of job results.
- **Processors** — `loadScores`, `groupResults`, `groupByVariant`, `computeDeltas`, `resultVariant`, and the `MODES` constant for building custom views over results.
- **Nunjucks filters** — `registerFilters` / `ALL_FILTERS` for the report templates.

## Usage

```ts
import { loadScores, renderHtml } from '@a0/evals-reporter';
import { writeFileSync } from 'node:fs';

const results = loadScores(['scores-latest.json']);
const html = renderHtml(results, new Date().toISOString());
writeFileSync('report.html', html);
```

Most consumers generate reports via the CLI instead:

```bash
a0-eval report --input scores-latest.json --output report.html
```

See the [monorepo README](https://github.com/auth0/auth0-evals) for the full framework guide.

## License

Apache-2.0 © Okta, Inc. See [LICENSE](https://github.com/auth0/auth0-evals/blob/main/LICENSE).
