import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authService: AuthService
    @State private var name = ""

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 8) {
                Image(systemName: "note.text")
                    .font(.system(size: 64))
                    .foregroundStyle(.blue)
                Text("壹识")
                    .font(.largeTitle.bold())
                Text("顺手记一条")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 16) {
                TextField("你的名字", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 280)
                    .onSubmit { login() }

                Button(action: login) {
                    Label("进入", systemImage: "arrow.right.circle.fill")
                        .frame(maxWidth: 280)
                        .frame(height: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func login() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        authService.devLogin(name: trimmed)
    }
}
