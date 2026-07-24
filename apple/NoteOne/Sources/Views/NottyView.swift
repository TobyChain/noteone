import SwiftUI
#if os(macOS)
import AppKit
#endif

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
    @State private var chatError: String?
    @State private var llmConfigured: Bool? = nil
    @State private var showLLMNotConfiguredAlert = false
    @State private var liveActivities: [ToolActivity] = []
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
                        if sessions.isEmpty && sessionId == nil && !isLoading {
                            VStack(spacing: DG.sp8) {
                                Image(systemName: "bubble.left.and.bubble.right")
                                    .font(.system(size: DG.iconEmpty))
                                    .foregroundStyle(Color.inkTertiary)
                                Text(L("还没有对话", "No Conversations Yet"))
                                    .font(.headline)
                                    .foregroundStyle(Color.inkSecondary)
                                Text(L("输入消息开始与闹闹交流。", "Type a message to start chatting with Notty."))
                                    .font(.subheadline)
                                    .foregroundStyle(Color.inkTertiary)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                        }
                        ForEach(messages) { msg in
                            ChatBubble(message: msg)
                                .id(msg.id)
                        }
                        if !liveActivities.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(liveActivities) { activity in
                                    ToolActivityRow(activity: activity)
                                }
                            }
                            .padding(.leading, 12)
                            .id("activities")
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
                .onChange(of: liveActivities.count) {
                    if !liveActivities.isEmpty {
                        withAnimation { proxy.scrollTo("activities", anchor: .bottom) }
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
        .alert(L("AI 模型未配置", "AI Model Not Configured"), isPresented: $showLLMNotConfiguredAlert) {
            Button(L("去设置", "Go to Settings")) {
                #if os(macOS)
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                #endif
            }
            Button(L("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(L("请先在设置中配置 API Key 后再使用 AI 功能。", "Please configure your API Key in Settings before using AI features."))
        }
        .overlay(alignment: .top) {
            if let chatError = chatError {
                HStack(spacing: DG.sp8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(chatError)
                        .font(.caption)
                        .foregroundStyle(Color.inkSecondary)
                        .lineLimit(2)
                    Spacer()
                    Button {
                        self.chatError = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color.inkTertiary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, DG.sp12)
                .padding(.vertical, DG.sp8)
                .background(Color.danger.opacity(0.08))
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    private func initSession() async {
        do {
            sessions = try await APIClient.shared.listChatSessions()
            if let latest = sessions.first {
                sessionId = latest.id
                let detail = try await APIClient.shared.getChatSession(id: latest.id)
                messages = Self.mapHistory(detail.messages)
            }
        } catch {
            // No sessions yet or network issue — just start fresh
        }

        do {
            let settings = try await APIClient.shared.getSettings()
            await MainActor.run { llmConfigured = settings.llm.hasApiKey }
        } catch {
            // If we can't check, allow sending and let the server return the error
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
                    messages = Self.mapHistory(detail.messages)
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

    /// Rebuilds the chat flow from persisted messages: intermediate assistant tool_calls and
    /// their tool results are folded into ToolActivity rows attached to Notty's final reply,
    /// instead of showing up as raw JSON bubbles.
    static func mapHistory(_ serverMessages: [ServerChatMessage]) -> [ChatMessage] {
        var result: [ChatMessage] = []
        var pending: [ToolActivity] = []
        var pendingIndexByCallId: [String: Int] = [:]

        for msg in serverMessages {
            if msg.role == "assistant", let calls = msg.toolCalls, !calls.isEmpty {
                for call in calls {
                    var activity = ToolActivity(name: call.function.name, argsSummary: summarizeArgsJSON(call.function.arguments))
                    activity.isRunning = false
                    pendingIndexByCallId[call.id] = pending.count
                    pending.append(activity)
                }
            } else if msg.role == "tool" {
                if let callId = msg.toolCallId, let idx = pendingIndexByCallId[callId] {
                    pending[idx].resultPreview = String(msg.content.prefix(400))
                }
            } else if msg.role == "assistant", !pending.isEmpty {
                result.append(ChatMessage(role: msg.role, content: msg.content, toolActivities: pending))
                pending.removeAll()
                pendingIndexByCallId.removeAll()
            } else {
                result.append(ChatMessage(role: msg.role, content: msg.content))
            }
        }
        return result
    }

    private static func summarizeArgsJSON(_ raw: String) -> String? {
        guard let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              !obj.isEmpty else { return nil }
        let parts = obj.prefix(2).map { "\($0.key)=\(String(describing: $0.value))" }
        let joined = parts.joined(separator: ", ")
        return joined.count > 80 ? String(joined.prefix(80)) + "…" : joined
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

        if let configured = llmConfigured, !configured {
            showLLMNotConfiguredAlert = true
            return
        }

        let userMsg = ChatMessage(role: "user", content: text)
        messages.append(userMsg)
        input = ""
        isLoading = true
        chatError = nil
        liveActivities = []

        Task {
            do {
                if sessionId == nil {
                    let session = try await APIClient.shared.createChatSession()
                    sessionId = session.id
                }
                guard let sid = sessionId else { return }
                let stream = await APIClient.shared.streamSessionMessage(sessionId: sid, message: text)
                var gotFinalMessage = false
                for try await event in stream {
                    switch event {
                    case .toolStart(let name, let argsSummary):
                        liveActivities.append(ToolActivity(name: name, argsSummary: argsSummary))
                    case .toolEnd(let name, let durationMs, let preview):
                        if let idx = liveActivities.lastIndex(where: { $0.name == name && $0.isRunning }) {
                            liveActivities[idx].isRunning = false
                            liveActivities[idx].durationMs = durationMs
                            liveActivities[idx].resultPreview = preview
                        }
                    case .message(let response):
                        gotFinalMessage = true
                        for i in liveActivities.indices { liveActivities[i].isRunning = false }
                        messages.append(ChatMessage(role: response.role, content: response.content, toolActivities: liveActivities))
                        liveActivities = []
                        isLoading = false
                    case .failure(let message):
                        throw APIError.serverMessage(statusCode: 500, message: message)
                    }
                }
                if !gotFinalMessage && isLoading {
                    isLoading = false
                    liveActivities = []
                    chatError = L("连接中断，未收到完整回复", "Connection lost before the reply completed")
                }
            } catch {
                chatError = error.localizedDescription
                messages.append(ChatMessage(role: "assistant", content: L("抱歉，出了点问题：", "Sorry, something went wrong: ") + error.localizedDescription))
                liveActivities = []
                isLoading = false
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

                if !message.toolActivities.isEmpty {
                    ForEach(message.toolActivities) { activity in
                        ToolActivityRow(activity: activity)
                    }
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
                } else if !message.content.isEmpty {
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
