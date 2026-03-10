import Foundation

// TODO: implement Auth0 authentication manager
// Should handle: login, logout, credential storage, token renewal
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
}
