from agent_eval.graders import contains, not_contains, matches, judge


def define_graders() -> list[dict]:
    return [
        # Positive: correct SDK and patterns
        contains("@auth0/nextjs-auth0"),
        contains("handleAuth"),
        contains("getSession"),
        matches(r"AUTH0_SECRET"),
        matches(r"AUTH0_BASE_URL"),
        matches(r"AUTH0_ISSUER_BASE_URL"),
        matches(r"AUTH0_CLIENT_ID"),
        matches(r"AUTH0_CLIENT_SECRET"),
        contains("UserProvider"),

        # Negative: hallucinated packages and dangerous patterns
        not_contains("@auth0/nextjs-sdk", "No hallucinated @auth0/nextjs-sdk package"),
        not_contains("@auth0/auth0-react", "Does not use SPA SDK in server app"),
        not_contains("barkbook_secret_def456uvw", "No hardcoded client secret in source files"),

        judge(
            "Does the solution correctly integrate Auth0 into a Next.js App Router app "
            "using handleAuth route handler, getSession, and UserProvider?",
            framework="nextjs",
        ),
    ]
