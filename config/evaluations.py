"""
Central evaluation registry.

Each entry describes one eval:
  id       - unique identifier used in --eval CLI flag
  name     - human-readable display name
  category - grouping label (used for filtering)
  path     - path to the eval directory, relative to eval_framework/
             Must contain: PROMPT.md, graders.py, scaffold/ (optional)

To add a new eval:
  1. Create a directory under evals/<your_eval_id>/
  2. Add PROMPT.md (task description with ## System and ## Task sections)
  3. Add graders.py with a define_graders() function
  4. Optionally add scaffold/ with starter files
  5. Register it here
"""

EVALUATIONS = [
    {
        "id":       "ios_auth0_integration",
        "name":     "iOS Auth0 Integration",
        "category": "auth",
        "path":     "evals/ios_auth0_integration",
    },
    {
        "id":       "ios_credentials_manager",
        "name":     "iOS CredentialsManager Setup",
        "category": "auth-credentials",
        "path":     "evals/ios_credentials_manager",
    },
    {
        "id":       "react_quickstart",
        "name":     "React Quickstart",
        "category": "quickstarts",
        "path":     "evals/quickstarts/react",
    },
]
