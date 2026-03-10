from agent_eval.graders import contains, matches, judge


def define_graders() -> list[dict]:
    return [
        contains("auth0/Auth0.swift"),
        contains("Auth0.plist"),
        contains("webAuth()"),
        contains("CredentialsManager"),
        contains(".store(credentials:"),
        contains("offline_access"),
        contains("credentialsManager.credentials()"),
        contains(".logout()"),
        contains(".clear()"),
        contains("credentialsManager.user"),
        judge(
            "Does the solution implement a complete Auth0 Universal Login flow "
            "with secure credential storage using CredentialsManager, including "
            "login, logout, and access to the user profile?"
        ),
    ]
