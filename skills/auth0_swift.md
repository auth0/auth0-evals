# Auth0.swift SDK Reference

## Installation (Swift Package Manager)

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/auth0/Auth0.swift", from: "2.0.0")
],
targets: [
    .target(name: "MyApp", dependencies: ["Auth0"])
]
```

## Configuration

Create `Auth0.plist` in your app bundle:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>ClientId</key>
    <string>YOUR_CLIENT_ID</string>
    <key>Domain</key>
    <string>YOUR_DOMAIN.auth0.com</string>
</dict>
</plist>
```

## Universal Login (WebAuth)

```swift
import Auth0

// Login
let credentials = try await Auth0
    .webAuth()
    .scope("openid profile email offline_access")
    .start()

// Logout
try await Auth0
    .webAuth()
    .clearSession()
```

## CredentialsManager — Secure Token Storage

```swift
import Auth0

// Initialize (do this once, store as a property)
let credentialsManager = CredentialsManager(authentication: Auth0.authentication())

// Store after login
let stored = credentialsManager.store(credentials: credentials)

// Retrieve (auto-renews with refresh token if expired)
let credentials = try await credentialsManager.credentials()

// Access user profile from stored ID token
let user: UserInfo? = credentialsManager.user
// user?.name, user?.email, user?.picture

// Clear on logout
let cleared = credentialsManager.clear()

// Enable biometric protection
credentialsManager.enableBiometrics(withTitle: "Unlock App")
```

## SwiftUI Integration Pattern

```swift
@MainActor
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    private let credentialsManager = CredentialsManager(authentication: Auth0.authentication())

    var user: UserInfo? { credentialsManager.user }

    func login() async throws {
        let credentials = try await Auth0
            .webAuth()
            .scope("openid profile email offline_access")
            .start()
        _ = credentialsManager.store(credentials: credentials)
        isAuthenticated = true
    }

    func logout() async throws {
        try await Auth0.webAuth().clearSession()
        _ = credentialsManager.clear()
        isAuthenticated = false
    }

    func getCredentials() async throws -> Credentials {
        return try await credentialsManager.credentials()
    }
}
```

## Protected Views with @EnvironmentObject

```swift
// App entry point
@main
struct MyApp: App {
    @StateObject private var authManager = AuthManager()

    var body: some Scene {
        WindowGroup {
            Group {
                if authManager.isAuthenticated {
                    MainTabView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(authManager)
        }
    }
}

// LoginView
struct LoginView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var error: Error?

    var body: some View {
        VStack {
            Button("Login with Auth0") {
                Task {
                    do {
                        try await authManager.login()
                    } catch {
                        self.error = error
                    }
                }
            }
        }
        .alert("Login Failed", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error?.localizedDescription ?? "")
        }
    }
}
```

## Key Types

| Type | Description |
|------|-------------|
| `Credentials` | Access token, ID token, refresh token, expiry |
| `UserInfo` | Decoded ID token claims (name, email, picture, sub) |
| `CredentialsManager` | Keychain-backed token storage with auto-renewal |
| `WebAuth` | Universal Login flow builder |

## Common Scopes

- `openid` — required for ID token
- `profile` — name, picture
- `email` — email address
- `offline_access` — refresh token (enables auto-renewal)
