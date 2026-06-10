import SwiftUI

struct NottyView: View {
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isLoading = false
    @State private var isReady = false
    @State private var sessionId: String?
    @State private var sessions: [ChatSession] = []
    @State private var showSessionList = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "sparkle")
                    .foregroundStyle(Color.accent)
                Text("Notty")
                    .font(.headline)

                Spacer()

                Button { showSessionList.toggle() } label: {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(Color.inkSecondary)
                }
                .buttonStyle(.plain)
                .popover(isPresented: $showSessionList) {
                    SessionListPopover(
                        sessions: sessions,
                        currentSessionId: sessionId,
                        onSelect: { loadSession($0) },
                        onNew: { startNewSession() },
                        onDelete: { deleteSession($0) }
                    )
                }

                #if os(macOS)
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                #endif
            }
            .padding()

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { msg in
                            ChatBubble(message: msg)
                                .id(msg.id)
                        }
                        if isLoading {
                            HStack(spacing: 6) {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Notty 思考中...")
                                    .font(.caption)
                                    .foregroundStyle(Color.inkTertiary)
                            }
                            .padding(.leading, 12)
                            .id("loading")
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                .onChange(of: isLoading) {
                    if isLoading {
                        withAnimation { proxy.scrollTo("loading", anchor: .bottom) }
                    }
                }
            }

            Divider()

            HStack(spacing: 8) {
                TextField("问 Notty 关于你的笔记...", text: $input)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { send() }
                    .disabled(isLoading)

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
                .buttonStyle(.plain)
                .foregroundStyle(input.trimmingCharacters(in: .whitespaces).isEmpty ? Color.inkTertiary : Color.accent)
            }
            .padding()
        }
        .opacity(isReady ? 1 : 0)
        .offset(y: isReady ? 0 : 8)
        .animation(.easeOut(duration: 0.25), value: isReady)
        .onAppear {
            Task { await initSession() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                isReady = true
            }
        }
        .onDisappear {
            isReady = false
        }
    }

    private func initSession() async {
        do {
            sessions = try await APIClient.shared.listChatSessions()
            if let latest = sessions.first {
                sessionId = latest.id
                let detail = try await APIClient.shared.getChatSession(id: latest.id)
                messages = detail.messages.map { ChatMessage(role: $0.role, content: $0.content) }
            }
        } catch {
            // No sessions yet or network issue — just start fresh
        }

        if messages.isEmpty {
            messages.append(ChatMessage(
                role: "assistant",
                content: "你好！我是 Notty，你的笔记助手\n\n我可以帮你检索、总结和分析你的所有笔记。试试问我：\"最近有哪些关于 AI 的笔记？\""
            ))
        }
    }

    private func loadSession(_ session: ChatSession) {
        showSessionList = false
        sessionId = session.id
        messages = []
        Task {
            do {
                let detail = try await APIClient.shared.getChatSession(id: session.id)
                await MainActor.run {
                    messages = detail.messages.map { ChatMessage(role: $0.role, content: $0.content) }
                    if messages.isEmpty {
                        messages.append(ChatMessage(role: "assistant", content: "你好！我是 Notty，你的笔记助手"))
                    }
                }
            } catch {
                print("Load session failed: \(error)")
            }
        }
    }

    private func startNewSession() {
        showSessionList = false
        sessionId = nil
        messages = [ChatMessage(
            role: "assistant",
            content: "你好！我是 Notty，你的笔记助手\n\n我可以帮你检索、总结和分析你的所有笔记。试试问我：\"最近有哪些关于 AI 的笔记？\""
        )]
    }

    private func deleteSession(_ session: ChatSession) {
        Task {
            do {
                try await APIClient.shared.deleteChatSession(id: session.id)
                await MainActor.run {
                    sessions.removeAll { $0.id == session.id }
                    if sessionId == session.id {
                        startNewSession()
                    }
                }
            } catch {
                print("Delete session failed: \(error)")
            }
        }
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }

        let userMsg = ChatMessage(role: "user", content: text)
        messages.append(userMsg)
        input = ""
        isLoading = true

        Task {
            do {
                if sessionId == nil {
                    let session = try await APIClient.shared.createChatSession()
                    await MainActor.run { sessionId = session.id }
                }
                guard let sid = sessionId else { return }
                let response = try await APIClient.shared.sendSessionMessage(sessionId: sid, message: text)
                await MainActor.run {
                    messages.append(ChatMessage(role: response.role, content: response.content))
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    messages.append(ChatMessage(role: "assistant", content: "抱歉，出了点问题：\(error.localizedDescription)"))
                    isLoading = false
                }
            }
        }
    }
}

private struct SessionListPopover: View {
    let sessions: [ChatSession]
    let currentSessionId: String?
    let onSelect: (ChatSession) -> Void
    let onNew: () -> Void
    let onDelete: (ChatSession) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onNew) {
                Label("新对话", systemImage: "plus")
            }
            .buttonStyle(.plain)
            .padding(10)

            Divider()

            if sessions.isEmpty {
                Text("暂无历史对话")
                    .font(.caption)
                    .foregroundStyle(Color.inkTertiary)
                    .padding()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(sessions) { session in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(session.title ?? "未命名对话")
                                        .font(.subheadline)
                                        .lineLimit(1)
                                    Text(session.updatedAt, style: .relative)
                                        .font(.caption2)
                                        .foregroundStyle(Color.inkTertiary)
                                }

                                Spacer()

                                if session.id == currentSessionId {
                                    Image(systemName: "checkmark")
                                        .font(.caption)
                                        .foregroundStyle(Color.accent)
                                }

                                Button { onDelete(session) } label: {
                                    Image(systemName: "trash")
                                        .font(.caption)
                                        .foregroundStyle(.red.opacity(0.7))
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                            .onTapGesture { onSelect(session) }
                            .background(session.id == currentSessionId ? Color.canvasSecondary : .clear)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    }
                    .padding(4)
                }
                .frame(maxHeight: 300)
            }
        }
        .frame(width: 260)
    }
}

private struct ChatBubble: View {
    let message: ChatMessage

    var isUser: Bool { message.role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 60) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                if !isUser {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkle")
                            .font(.caption2)
                        Text("Notty")
                            .font(.caption2)
                    }
                    .foregroundStyle(Color.inkTertiary)
                }

                Text(message.content)
                    .font(.body)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(isUser ? Color.accent : Color.canvasSecondary)
                    .foregroundStyle(isUser ? .white : Color.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            if !isUser { Spacer(minLength: 60) }
        }
    }
}
