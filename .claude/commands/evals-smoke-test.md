Smoke-test the eval framework to verify changes work end-to-end.

1. **Build first:**
```bash
npm run build
```

2. **Full matrix for react_quickstart:**
```bash
npm run run -- --eval react_quickstart --matrix
```

After each command completes, summarize the results (pass/fail counts, any errors).

3. **Generate report:**
```bash
npm run report
```

At the end, give an overall smoke-test verdict: PASS if the build and eval run succeeded without errors, FAIL otherwise.
