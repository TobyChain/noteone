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
    @State private var supplement: NewLoreSupplementProgress?
    @State private var supplementTimer: Timer?
    @State private var studyReportNotified = false
    @State private var supplementDoneFlash = false
    @State private var llmConfigured: Bool? = nil
    @State private var showLLMNotConfiguredAlert = false
    @State private var liveActivities: [ToolActivity] = []
    @State private var responseTask: Task<Void, Never>?
    @FocusState private var composerFocused: Bool
    var onClose: (() -> Void)? = nil

    private let promptSuggestions: [String] = [
        L("搜索我的笔记并读取原文", "Search my notes and read the sources"),
        L("联网搜索最近的 Agent 进展并附链接", "Search the web for recent agent advances with links"),
        L("比较我的笔记与最新网络信息", "Compare my notes with current web information"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: DG.sp8) {
                Image("NottyAvatar")
                    .resizable()
                    .frame(width: 26, height: 26)
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 1) {
                    Text(L("闹闹", "Notty"))
                        .font(.headline)
                    Text(isLoading ? L("正在工作", "Working") : L("可读取笔记与联网搜索", "Notes and web search ready"))
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                }

                Spacer()

                Button { startNewSession() } label: {
                    Image(systemName: "plus")
                        .foregroundStyle(Color.inkSecondary)
                }
                .buttonStyle(.plain)
                .disabled(isLoading)

                Button { showSessionList.toggle() } label: {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(Color.inkSecondary)
                }
                .buttonStyle(.plain)
                .disabled(isLoading)
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
            .padding(.horizontal, DG.sp16)
            .padding(.vertical, DG.sp12)

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
                            ChatBubble(message: msg) { url in
                                send(L("用 learn-art 深入分析这个链接：", "Analyze this link with learn-art: ") + url)
                            }
                            .equatable()
                            .id(msg.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        // No withAnimation: animated scrollTo on a growing
                        // LazyVStack can feed back into layout and spin the main thread.
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            if isLoading {
                VStack(alignment: .leading, spacing: DG.sp8) {
                    HStack(spacing: DG.sp8) {
                        ProgressView().controlSize(.small)
                        Text(liveActivities.last.map { activityStatus($0) } ?? L("正在理解问题", "Understanding request"))
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                            .lineLimit(1)
                        Spacer()
                        Button(L("停止", "Stop"), action: stopResponse)
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                    ForEach(Array(liveActivities.suffix(4))) { activity in
                        ToolActivityRow(activity: activity)
                    }
                }
                .padding(DG.sp12)
                .background(Color.canvasSecondary)
                .clipShape(RoundedRectangle(cornerRadius: DG.r12))
                .padding(.horizontal, DG.sp12)
                .padding(.top, DG.sp8)
            }

            if let supp = supplement, supp.isRunning || supplementDoneFlash {
                supplementBanner(supp)
            }

            if messages.count <= 1 && supplement == nil && !isLoading {
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

            VStack(alignment: .leading, spacing: DG.sp8) {
                TextField(
                    L("提问、搜索笔记或联网查找…", "Ask, search notes, or search the web…"),
                    text: $input,
                    axis: .vertical
                )
                .textFieldStyle(.plain)
                .lineLimit(1...6)
                .focused($composerFocused)
                .onSubmit { if !isLoading { send() } }

                HStack {
                    Text(L("Return 发送 · Shift-Return 换行", "Return to send · Shift-Return for newline"))
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                    Spacer()
                    Button {
                        if isLoading { stopResponse() } else { send() }
                    } label: {
                        Image(systemName: isLoading ? "stop.fill" : "arrow.up")
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .disabled(!isLoading && input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(DG.sp12)
            .background(Color.canvasSecondary)
            .clipShape(RoundedRectangle(cornerRadius: DG.r12))
            .overlay(RoundedRectangle(cornerRadius: DG.r12).stroke(Color.hairline, lineWidth: 0.75))
            .padding(DG.sp12)
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
            responseTask?.cancel()
            responseTask = nil
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
    }

    private func activityStatus(_ activity: ToolActivity) -> String {
        guard let summary = activity.argsSummary, !summary.isEmpty else {
            return ToolActivityRow.displayName(for: activity.name)
        }
        return ToolActivityRow.displayName(for: activity.name) + " · " + summary
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
                content: L("你好！我是闹闹。我可以检索并读取你的笔记，也可以联网搜索最新资料并保留来源链接。", "Hi! I'm Notty. I can search and read your notes, or search the web for current sources and links.")
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
            content: L("你好！我是闹闹。我可以检索并读取你的笔记，也可以联网搜索最新资料并保留来源链接。", "Hi! I'm Notty. I can search and read your notes, or search the web for current sources and links.")
        )]
    }

    /// Rebuilds the chat flow from persisted messages: intermediate assistant tool_calls and
    /// their tool results are folded into ToolActivity rows attached to the next assistant
    /// text bubble, instead of showing up as raw JSON bubbles. Assistant messages that carry
    /// BOTH text and tool_calls ("我先看看…", then tools) render their text as its own bubble.
    static func mapHistory(_ serverMessages: [ServerChatMessage]) -> [ChatMessage] {
        var result: [ChatMessage] = []
        var pending: [ToolActivity] = []
        var pendingIndexByCallId: [String: Int] = [:]

        for msg in serverMessages {
            if msg.role == "assistant", let calls = msg.toolCalls, !calls.isEmpty {
                if !msg.content.isEmpty {
                    // Mid-reply text: flush the previous segment's activities into its bubble.
                    result.append(ChatMessage(role: msg.role, content: msg.content, toolActivities: pending))
                    pending.removeAll()
                    pendingIndexByCallId.removeAll()
                }
                for call in calls {
                    var activity = ToolActivity(id: call.id, name: call.function.name, argsSummary: summarizeArgsJSON(call.function.arguments))
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
        let text = (preset ?? input).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isLoading else { return }

        if let configured = llmConfigured, !configured {
            showLLMNotConfiguredAlert = true
            return
        }

        let userMsg = ChatMessage(role: "user", content: text)
        messages.append(userMsg)
        input = ""
        isLoading = true
        liveActivities = []

        responseTask = Task {
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
                    case .toolStart(let callId, let name, let argsSummary):
                        liveActivities.append(ToolActivity(id: callId, name: name, argsSummary: argsSummary))
                    case .toolEnd(let callId, _, let durationMs, let preview, let isError):
                        if let idx = liveActivities.lastIndex(where: { $0.id == callId }) {
                            liveActivities[idx].isRunning = false
                            liveActivities[idx].durationMs = durationMs
                            liveActivities[idx].resultPreview = preview
                            liveActivities[idx].isError = isError
                        }
                    case .intermediate(let content):
                        // Mid-reply: bubble up the text with the tools run so far,
                        // then keep collecting activities for the next segment.
                        for i in liveActivities.indices { liveActivities[i].isRunning = false }
                        messages.append(ChatMessage(role: "assistant", content: content, toolActivities: liveActivities))
                        liveActivities = []
                    case .message(let response):
                        gotFinalMessage = true
                        for i in liveActivities.indices { liveActivities[i].isRunning = false }
                        messages.append(ChatMessage(role: response.role, content: response.content, toolActivities: liveActivities))
                        liveActivities = []
                        isLoading = false
                        responseTask = nil
                    case .failure(let message):
                        throw APIError.serverMessage(statusCode: 500, message: message)
                    }
                }
                if !gotFinalMessage && isLoading {
                    isLoading = false
                    liveActivities = []
                    messages.append(ChatMessage(role: "assistant", content: L("连接中断，未收到完整回复", "Connection lost before the reply completed")))
                    responseTask = nil
                }
            } catch {
                guard !Task.isCancelled else { return }
                messages.append(ChatMessage(role: "assistant", content: L("抱歉，出了点问题：", "Sorry, something went wrong: ") + error.localizedDescription))
                liveActivities = []
                isLoading = false
                responseTask = nil
            }
        }
    }

    private func stopResponse() {
        guard isLoading else { return }
        responseTask?.cancel()
        responseTask = nil
        for index in liveActivities.indices { liveActivities[index].isRunning = false }
        messages.append(ChatMessage(
            role: "assistant",
            content: L("已停止当前回答。", "Stopped the current response."),
            toolActivities: liveActivities
        ))
        liveActivities = []
        isLoading = false
        composerFocused = true
    }

    // MARK: - Supplement progress

    @ViewBuilder
    private func supplementBanner(_ supp: NewLoreSupplementProgress) -> some View {
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
                    Text(L("新知补充", "NewLore Update") + " · \(supp.currentLabel)")
                        .font(.caption)
                        .foregroundStyle(Color.ink)
                    Text("\(supp.doneCount)/\(supp.modules.count)")
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                } else if supp.phase == "done" {
                    Text(L("新知补充完成", "NewLore Update Complete"))
                        .font(.caption)
                        .foregroundStyle(Color.success)
                    if !supp.failedModules.isEmpty {
                        let failed = supp.failedModules.map { $0.label }.joined(separator: "、")
                        Text(L("失败：\(failed)", "Failed: \(failed)"))
                            .font(.caption2)
                            .foregroundStyle(Color.danger)
                            .lineLimit(2)
                        if let detail = supp.failedModules.compactMap({ $0.error }).first {
                            Text(detail)
                                .font(.caption2)
                                .foregroundStyle(Color.inkTertiary)
                                .lineLimit(2)
                        }
                    }
                } else {
                    Text(L("新知补充出错", "NewLore Update Error"))
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
                    Task { try? await APIClient.shared.abortNewLore() }
                } label: {
                    Image(systemName: "stop.circle")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                }
                .buttonStyle(.plain)
                .help(L("打断", "Abort"))
            } else if supp.phase == "failed" || !supp.failedModules.isEmpty {
                Button(L("重试", "Retry")) {
                    Task { try? await APIClient.shared.triggerNewLore(date: supp.date) }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
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
                    let status = try await APIClient.shared.getNewLoreStatus()
                    if let supp = status.supplement {
                        if supp.isRunning && supplement == nil {
                            supplement = supp
                        } else if supp.isRunning {
                            supplement = supp
                        } else if !supp.isRunning && supplement != nil {
                            supplement = supp
                            supplementDoneFlash = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                                supplementDoneFlash = false
                                supplement = nil
                            }
                        }
                    }
                    if let sr = status.studyReport {
                        if sr.isRunning {
                            studyReportNotified = false
                        } else if sr.phase == "done", sr.noteId != nil, !studyReportNotified {
                            studyReportNotified = true
                            messages.append(ChatMessage(
                                role: "assistant",
                                content: L("学习报告已生成并保存到往事：", "Study report generated and saved to OldEcho: ") + (sr.title ?? "")
                            ))
                            NotificationCenter.default.post(name: .noteCreated, object: nil)
                        } else if sr.phase == "failed", !studyReportNotified {
                            studyReportNotified = true
                            messages.append(ChatMessage(
                                role: "assistant",
                                content: L("学习报告生成失败：", "Study report generation failed: ") + (sr.error ?? "")
                            ))
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

private struct ChatBubble: View, Equatable {
    let message: ChatMessage
    var onLearnArtAnalyze: ((String) -> Void)? = nil

    // Equality on message only (the closure is never comparable). Combined with
    // .equatable() in the ForEach this skips body re-eval — and the synchronous
    // markdown parse below — for unchanged bubbles while SSE events stream in.
    nonisolated static func == (lhs: ChatBubble, rhs: ChatBubble) -> Bool {
        lhs.message == rhs.message
    }

    var isUser: Bool { message.role == "user" }

    private func extractURLs(from text: String) -> [String] {
        let pattern = #"https?://[^\s<>"')\]]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard let r = Range(match.range, in: text) else { return nil }
            return String(text[r])
        }
    }

    @ViewBuilder
    private var messageContextMenu: some View {
        let urls = extractURLs(from: message.content)
        ForEach(urls, id: \.self) { url in
            Button {
                onLearnArtAnalyze?(url)
            } label: {
                Label(L("用 learn-art 深入分析", "Analyze with learn-art"), systemImage: "book.fill")
            }
        }
        Button {
            #if os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(message.content, forType: .string)
            #elseif os(iOS)
            UIPasteboard.general.string = message.content
            #endif
        } label: {
            Label(L("复制", "Copy"), systemImage: "doc.on.doc")
        }
    }

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
                        .contextMenu { messageContextMenu }
                } else if !message.content.isEmpty {
                    Text(markdownAttributed(NottySidebarText.format(message.content)))
                        .font(.body)
                        .textSelection(.enabled)
                        .padding(.horizontal, DG.sp12)
                        .padding(.vertical, DG.sp8)
                        .background(Color.canvasSecondary)
                        .foregroundStyle(Color.ink)
                        .clipShape(RoundedRectangle(cornerRadius: DG.r16))
                        .contextMenu { messageContextMenu }
                }
            }

            if !isUser { Spacer(minLength: 60) }
        }
    }

    private func markdownAttributed(_ text: String) -> AttributedString {
        // AttributedString markdown parsing is slow on large/pathological input
        // (heavy inline markers) and runs synchronously on the main thread —
        // skip it for huge payloads so one bad message can't beachball the app.
        guard text.count < 8_000 else { return AttributedString(text) }
        let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        if let attr = try? AttributedString(markdown: text, options: opts) {
            return attr
        }
        return AttributedString(text)
    }
}

enum NottySidebarText {
    static func format(_ text: String) -> String {
        let lines = text.components(separatedBy: .newlines)
        var output: [String] = []
        var index = 0

        while index < lines.count {
            guard index + 1 < lines.count,
                  let headers = cells(in: lines[index]),
                  isDivider(lines[index + 1], columns: headers.count) else {
                output.append(lines[index])
                index += 1
                continue
            }

            index += 2
            var rows: [[String]] = []
            while index < lines.count, let row = cells(in: lines[index]), row.count == headers.count {
                rows.append(row)
                index += 1
            }
            for row in rows {
                let summary = zip(headers, row)
                    .filter { !$0.1.isEmpty }
                    .map { "\($0.0)：\($0.1)" }
                    .joined(separator: " · ")
                output.append("• " + summary)
            }
        }
        return output.joined(separator: "\n")
    }

    private static func cells(in line: String) -> [String]? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("|") else { return nil }
        let body = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
        let values = body.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        return values.count > 1 ? values : nil
    }

    private static func isDivider(_ line: String, columns: Int) -> Bool {
        guard let values = cells(in: line), values.count == columns else { return false }
        return values.allSatisfy { value in
            let marks = value.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
            return marks.count >= 3 && marks.allSatisfy { $0 == "-" }
        }
    }
}
