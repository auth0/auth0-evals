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

                Button("Logout") {
                }
            } else {
                Button("Login") {
                }
            }
        }
        .padding()
    }
}
