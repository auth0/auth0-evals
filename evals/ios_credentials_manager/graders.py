from agent_eval.graders import contains, judge


def define_graders() -> list[dict]:
    return [
        contains("CredentialsManager("),
        contains("Auth0.authentication()"),
        contains(".store(credentials:"),
        contains("credentialsManager.credentials()"),
        contains("enableBiometrics("),
        contains("credentialsManager.clear()"),
        contains(".clearSession()"),
        judge(
            "Does the solution correctly implement CredentialsManager for "
            "secure token storage, auto-renewal, biometric lock, and logout?"
        ),
    ]
