import SwiftUI

struct NottyView: View {
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isLoading = false
    @State private var isReady = false
    @State private var sessionId: String?
    @State private var sessions: [ChatSession] = []
    @State private var showSessionList = false
    @State private var supplement: AscanSupplementProgress?
    @State private var supplementTimer: Timer?
    @State private var supplementDoneFlash = false
    var onClose: (() -> Void)? = nil

    private let promptSuggestions: [String] = [
        L("帮我补充今日新知", "Help me supplement today's NewSee"),
        L("每天 8 点自动补充新知", "Auto-supplement NewSee every day at 8 AM"),
        L("搜索本地文件里的 TODO", "Search for TODOs in local files"),
        L("列出桌面上的文件", "List files on the Desktop"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image("NottyAvatar")
                    .resizable()
                    .frame(width: 28, height: 28)
                    .clipShape(Circle())
                Text(L("闹闹", "Notty"))
                    .font(.headline)

                Spacer()

                Button { startNewSession() } label: {
                    Image(systemName: "plus")
                        .foregroundStyle(Color.inkSecondary)
                }
                .buttonStyle(.plain)

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
                Button { onClose?() } label: {
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
                                Text(L("Notty 思考中...", "Notty is thinking..."))
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

            if let supp = supplement, supp.isRunning || supplementDoneFlash {
                supplementBanner(supp)
            }

            if messages.count <= 1 && supplement == nil {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DG.sp8) {
                        ForEach(promptSuggestions, id: \.self) { suggestion in
                            Button {
                                send(suggestion)
                            } label: {
                                Text(suggestion)
                                    .font(.caption)
                                    .foregroundStyle(Color.inkSecondary)
                                    .padding(.horizontal, DG.sp12)
                                    .padding(.vertical, DG.sp4)
                                    .background(Color.canvasSecondary)
                                    .clipShape(Capsule())
                                    .overlay(Capsule().stroke(Color.hairline, lineWidth: 0.5))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }

            HStack(spacing: 8) {
                TextField(L("问 Notty 关于你的笔记...", "Ask Notty about your notes..."), text: $input)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { send() }
                    .disabled(isLoading)

                Button { send() } label: {
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
            startSupplementPolling()
        }
        .onDisappear {
            isReady = false
            stopSupplementPolling()
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
                content: L("你好！我是 Notty，你的笔记助手\n\n我可以帮你检索、总结和分析你的所有笔记。试试问我：\"最近有哪些关于 AI 的笔记？\"", "Hi! I'm Notty, your note assistant.\n\nI can help you search, summarize, and analyze all your notes. Try asking: \"What recent notes do I have about AI?\"")
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
                        messages.append(ChatMessage(role: "assistant", content: L("你好！我是 Notty，你的笔记助手", "Hi! I'm Notty, your note assistant.")))
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
            content: L("你好！我是 Notty，你的笔记助手\n\n我可以帮你检索、总结和分析你的所有笔记。试试问我：\"最近有哪些关于 AI 的笔记？\"", "Hi! I'm Notty, your note assistant.\n\nI can help you search, summarize, and analyze all your notes. Try asking: \"What recent notes do I have about AI?\"")
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

    private func send(_ preset: String? = nil) {
        let text = (preset ?? input).trimmingCharacters(in: .whitespaces)
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
                    messages.append(ChatMessage(role: "assistant", content: L("抱歉，出了点问题：", "Sorry, something went wrong: ") + error.localizedDescription))
                    isLoading = false
                }
            }
        }
    }

    // MARK: - Supplement progress

    @ViewBuilder
    private func supplementBanner(_ supp: AscanSupplementProgress) -> some View {
        HStack(spacing: DG.sp8) {
            if supp.isRunning {
                ProgressView()
                    .controlSize(.small)
            } else if supp.phase == "done" {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.success)
            } else {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.danger)
            }

            VStack(alignment: .leading, spacing: 2) {
                if supp.isRunning {
                    Text(L("新知补充", "NewSee Update") + " · \(supp.currentLabel)")
                        .font(.caption)
                        .foregroundStyle(Color.ink)
                    Text("\(supp.doneCount)/\(supp.modules.count)")
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                } else if supp.phase == "done" {
                    Text(L("新知补充完成", "NewSee Update Complete"))
                        .font(.caption)
                        .foregroundStyle(Color.success)
                    if !supp.failedModules.isEmpty {
                        Text(L("\(supp.failedModules.count) 个模块失败（已跳过）", "\(supp.failedModules.count) module(s) failed (skipped)"))
                            .font(.caption2)
                            .foregroundStyle(Color.inkTertiary)
                    }
                } else {
                    Text(L("新知补充出错", "NewSee Update Error"))
                        .font(.caption)
                        .foregroundStyle(Color.danger)
                    if let err = supp.error {
                        Text(err)
                            .font(.caption2)
                            .foregroundStyle(Color.inkTertiary)
                            .lineLimit(2)
                    }
                }
            }

            Spacer()

            if supp.isRunning {
                Button {
                    Task { try? await APIClient.shared.abortAscan() }
                } label: {
                    Image(systemName: "stop.circle")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                }
                .buttonStyle(.plain)
                .help(L("打断", "Abort"))
            }
        }
        .padding(.horizontal)
        .padding(.vertical, DG.sp4)
        .background(supp.phase == "failed" ? Color.danger.opacity(0.05) : Color.canvasSecondary)
    }

    private func startSupplementPolling() {
        stopSupplementPolling()
        supplementTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            Task { @MainActor in
                do {
                    let status = try await APIClient.shared.getAscanStatus()
                    if let supp = status.supplement {
                        if supp.isRunning && supplement == nil {
                            supplement = supp
                        } else if supp.isRunning {
                            supplement = supp
                        } else if !supp.isRunning && supplement != nil {
                            // Just finished
                            supplement = supp
                            supplementDoneFlash = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                                supplementDoneFlash = false
                                supplement = nil
                            }
                        }
                    }
                } catch {}
            }
        }
    }

    private func stopSupplementPolling() {
        supplementTimer?.invalidate()
        supplementTimer = nil
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
                Label(L("新对话", "New Chat"), systemImage: "plus")
            }
            .buttonStyle(.plain)
            .padding(10)

            Divider()

            if sessions.isEmpty {
                Text(L("暂无历史对话", "No chat history"))
                    .font(.caption)
                    .foregroundStyle(Color.inkTertiary)
                    .padding()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(sessions) { session in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(session.title ?? L("未命名对话", "Untitled Chat"))
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
                        Image("NottyAvatar")
                            .resizable()
                            .frame(width: 16, height: 16)
                            .clipShape(Circle())
                        Text(L("闹闹", "Notty"))
                            .font(.caption2)
                    }
                    .foregroundStyle(Color.inkTertiary)
                }

                if isUser {
                    Text(message.content)
                        .font(.body)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.accent)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: DG.r16))
                } else {
                    Text(markdownAttributed(message.content))
                        .font(.body)
                        .textSelection(.enabled)
                        .padding(.horizontal, DG.sp12)
                        .padding(.vertical, DG.sp8)
                        .background(Color.canvasSecondary)
                        .foregroundStyle(Color.ink)
                        .clipShape(RoundedRectangle(cornerRadius: DG.r16))
                }
            }

            if !isUser { Spacer(minLength: 60) }
        }
    }

    private func markdownAttributed(_ text: String) -> AttributedString {
        let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        if let attr = try? AttributedString(markdown: text, options: opts) {
            return attr
        }
        return AttributedString(text)
    }
}
