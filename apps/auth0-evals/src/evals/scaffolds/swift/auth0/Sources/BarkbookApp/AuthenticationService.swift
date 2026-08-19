import Auth0
import SwiftUI

@MainActor
final class AuthenticationService: ObservableObject {
    @Published var isAuthenticated: Bool
    @Published var email: String?

    private let credentialsManager = CredentialsManager(authentication: Auth0.authentication())

    init() {
        isAuthenticated = credentialsManager.canRenew()
        email = try? credentialsManager.userProfile()?.email
    }

    func login() async {
        do {
            let credentials = try await Auth0
                .webAuth()
                .useHTTPS()
                .audience("https://api.barkbook.com")
                .scope("openid profile email offline_access")
                .start()
            _ = credentialsManager.store(credentials: credentials)
            isAuthenticated = true
            email = try? credentialsManager.userProfile()?.email
        } catch {
            print("Login failed: \(error)")
        }
    }

    func logout() async {
        do {
            try await Auth0.webAuth().useHTTPS().logout()
        } catch {
            print("Logout failed: \(error)")
        }
        _ = credentialsManager.clear()
        isAuthenticated = false
        email = nil
    }
}
