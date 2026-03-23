import SwiftUI

// TODO: Import Auth0

@main
struct BarkbookApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var isAuthenticated = false
    @State private var userProfile: String = ""
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Barkbook")
                .font(.largeTitle)
            
            if isAuthenticated {
                Text("Welcome!")
                Text(userProfile)
                    .font(.caption)
                
                // TODO: Add logout button
                Button("Logout") {
                    // TODO: Implement logout
                }
            } else {
                // TODO: Add login button
                Button("Login") {
                    // TODO: Implement login with Auth0
                }
            }
        }
        .padding()
    }
}
