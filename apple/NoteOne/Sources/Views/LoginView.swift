import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @EnvironmentObject var authService: AuthService

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 8) {
                Image(systemName: "note.text")
                    .font(.system(size: 64))
                    .foregroundStyle(.blue)
                Text("NoteOne")
                    .font(.largeTitle.bold())
                Text("顺手记一条")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.email, .fullName]
            } onCompletion: { result in
                switch result {
                case .success(let auth):
                    if let credential = auth.credential as? ASAuthorizationAppleIDCredential {
                        authService.signInWithApple(credential: credential)
                    }
                case .failure(let error):
                    print("Sign in failed: \(error)")
                }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 50)
            .frame(maxWidth: 280)

            #if DEBUG
            Divider()
                .frame(maxWidth: 280)

            Button {
                authService.devLogin(name: "Bingtao")
            } label: {
                Label("开发者快速登录", systemImage: "hammer.fill")
                    .frame(maxWidth: 280)
                    .frame(height: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
            #endif
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
