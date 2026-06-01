Smoke-test the eval framework to verify changes work end-to-end.

1. **Build first:**
```bash
npm run build
```

2. **Run baseline and agent modes for react_quickstart:**
```bash
npm run evals -- --eval react_quickstart --mode all --model all
```

After each command completes, summarize the results (pass/fail counts, any errors).

3. **Generate report:**
```bash
npm run report
```

At the end, give an overall smoke-test verdict: PASS if the build and eval run succeeded without errors, FAIL otherwise.
