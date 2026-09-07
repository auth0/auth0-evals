import SwiftUI

@main
struct BarkbookApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @StateObject private var auth = AuthenticationService()

    var body: some View {
        VStack(spacing: 20) {
            Text("Barkbook")
                .font(.largeTitle)

            if auth.isAuthenticated {
                Text("Welcome!")
                if let email = auth.email {
                    Text(email)
                        .font(.caption)
                }

                Button("Logout") {
                    Task { await auth.logout() }
                }
            } else {
                Button("Login") {
                    Task { await auth.login() }
                }
            }
        }
        .padding()
    }
}
