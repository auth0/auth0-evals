import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "pawprint.fill")
                .font(.system(size: 60))
                .foregroundColor(.blue)
            Text("Welcome to Barkbook")
                .font(.largeTitle).bold()
            Text("The social network for dogs")
                .foregroundColor(.secondary)

            Button("Login / Sign Up") {
                // TODO: trigger Auth0 Universal Login
            }
            .buttonStyle(.borderedProminent)

            Button("View Profile") {
                // TODO: show profile only when logged in
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }
}
