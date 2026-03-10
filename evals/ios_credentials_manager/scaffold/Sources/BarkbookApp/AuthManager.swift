import Auth0

// Login is already wired up. Your job:
// 1. Wrap Authentication() in a CredentialsManager
// 2. Store credentials after webAuth login
// 3. Retrieve credentials (with auto-renewal) via credentialsManager.credentials()
// 4. Enable biometric lock on the manager
// 5. Clear credentials on logout

@MainActor
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false

    func login() async throws {
        let credentials = try await Auth0
            .webAuth()
            .scope("openid profile email offline_access")
            .start()
        // TODO: store with CredentialsManager
        isAuthenticated = true
    }

    func logout() {
        // TODO: clear CredentialsManager + webAuth session
        isAuthenticated = false
    }

    func getCredentials() async throws -> Credentials {
        // TODO: return credentials via CredentialsManager (auto-renews if expired)
        throw NSError(domain: "NotImplemented", code: 0)
    }
}
