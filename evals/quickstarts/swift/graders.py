from agent_eval.graders import contains, matches, judge


def define_graders() -> list[dict]:
    return [
        contains("Auth0"),
        contains("import Auth0"),
        matches(r"webAuth\s*\(\s*clientId\s*:.*domain\s*:"),
        contains("login("),
        contains("logout("),
        matches(r"credentials\.(accessToken|idToken)"),
        contains("credentialsManager"),
        judge(
            "Does the solution correctly integrate Auth0 into a Swift iOS app using "
            "Auth0.webAuth(), login, logout, and credential management?"
        ),
    ]
