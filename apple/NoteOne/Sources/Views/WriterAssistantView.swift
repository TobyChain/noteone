import SwiftUI

/// In-page Notty assistant for the writer view. Differs from the global NottyView in that
/// it ships the document text + selection with every message so Notty can issue structured
/// `WriterAction`s that this view applies directly back into the editor's bindings.
struct WriterAssistantView: View {
    @Binding var documentText: String
    @Binding var selection: NSRange

    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isLoading = false
    @State private var sessionId: String?
    @State private var rewriteConfirm: WriterAction?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            transcript
            Divider()
            composer
        }
        .alert(
            "整篇替换确认",
            isPresented: Binding(
                get: { rewriteConfirm != nil },
                set: { if !$0 { rewriteConfirm = nil } }
            ),
            presenting: rewriteConfirm
        ) { action in
            Button("取消", role: .cancel) { rewriteConfirm = nil }
            Button("确认替换", role: .destructive) {
                applyAction(action, skipConfirm: true)
                rewriteConfirm = nil
            }
        } message: { action in
            Text("闹闹想用 \(action.text.count) 字的新内容覆盖整篇文档。当前文档共 \(documentText.count) 字。")
        }
        .task {
            if messages.isEmpty {
                // Load the latest session (shared with NottyView) so context carries over
                do {
                    let sessions = try await APIClient.shared.listChatSessions()
                    if let latest = sessions.first {
                        sessionId = latest.id
                        let detail = try await APIClient.shared.getChatSession(id: latest.id)
                        messages = detail.messages.map { ChatMessage(role: $0.role, content: $0.content) }
                    }
                } catch {}

                if messages.isEmpty {
                    messages.append(ChatMessage(
                        role: "assistant",
                        content: "我是闹闹写作助手。告诉我你想写什么，我可以在你的光标处插入草稿、替换选中段落、追加章节，或整篇重写。也可以用「找一下我笔记里关于…的内容」让我先检索素材。"
                    ))
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image("NottyAvatar")
                .resizable()
                .frame(width: 22, height: 22)
                .clipShape(Circle())
            Text("闹闹")
                .font(.subheadline.bold())
            Spacer()
            if selection.length > 0 {
                Label("已选 \(selection.length) 字", systemImage: "selection.pin.in.out")
                    .labelStyle(.titleAndIcon)
                    .font(.caption)
                    .foregroundStyle(Color.accent)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { msg in
                        bubble(msg).id(msg.id)
                    }
                    if isLoading {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text("闹闹思考中…")
                                .font(.caption)
                                .foregroundStyle(Color.inkTertiary)
                        }
                        .padding(.leading, 8)
                        .id("loading")
                    }
                }
                .padding(12)
            }
            .onChange(of: messages.count) {
                if let last = messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private func bubble(_ msg: ChatMessage) -> some View {
        let isUser = msg.role == "user"
        let isSystem = msg.role == "system"
        return HStack {
            if isUser { Spacer(minLength: 32) }
            Text(msg.content)
                .font(isSystem ? .caption : .body)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    isUser ? Color.accent
                    : isSystem ? Color.canvasSecondary.opacity(0.7)
                    : Color.canvasSecondary
                )
                .foregroundStyle(isUser ? .white : (isSystem ? Color.inkSecondary : Color.ink))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .textSelection(.enabled)
            if !isUser { Spacer(minLength: 32) }
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("让闹闹帮你写…", text: $input, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .onSubmit { send() }
                .disabled(isLoading)
            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
            }
            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
            .buttonStyle(.plain)
            .foregroundStyle(canSend ? Color.accent : Color.inkTertiary)
        }
        .padding(10)
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespaces).isEmpty && !isLoading
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        input = ""
        isLoading = true
        messages.append(ChatMessage(role: "user", content: text))

        // Snapshot the selection at send-time so the user can keep typing while we wait.
        let snapshotDoc = documentText
        let snapshotSelection: WriterSelectionRange? = selection.length > 0
            ? WriterSelectionRange(start: selection.location, end: selection.location + selection.length)
            : nil

        Task {
            do {
                let sid: String
                if let existing = sessionId {
                    sid = existing
                } else {
                    let session = try await APIClient.shared.createChatSession(title: "写作: " + text.prefix(40))
                    await MainActor.run { sessionId = session.id }
                    sid = session.id
                }
                let response = try await APIClient.shared.sendWriterMessage(
                    sessionId: sid,
                    message: text,
                    documentText: snapshotDoc,
                    selection: snapshotSelection
                )
                await MainActor.run {
                    messages.append(ChatMessage(role: "assistant", content: response.message.content))
                    isLoading = false
                    if let action = response.action {
                        applyAction(action)
                    }
                }
            } catch {
                await MainActor.run {
                    messages.append(ChatMessage(role: "assistant", content: "抱歉，出了点问题：\(error.localizedDescription)"))
                    isLoading = false
                }
            }
        }
    }

    /// Apply a Notty action to the bound document text. Rewrites are gated behind a confirm.
    private func applyAction(_ action: WriterAction, skipConfirm: Bool = false) {
        switch action.type {
        case .insertText:
            let ns = documentText as NSString
            let insertAt = min(selection.location, ns.length)
            let newDoc = ns.replacingCharacters(in: NSRange(location: insertAt, length: 0), with: action.text)
            documentText = newDoc
            selection = NSRange(location: insertAt + (action.text as NSString).length, length: 0)
            messages.append(ChatMessage(role: "system", content: "已在光标处插入 \(action.text.count) 字"))

        case .replaceSelection:
            if selection.length == 0 {
                // Nothing selected — fall back to inserting at the caret.
                applyAction(WriterAction(type: .insertText, text: action.text))
                return
            }
            let ns = documentText as NSString
            let safe = NSRange(
                location: min(selection.location, ns.length),
                length: min(selection.length, max(0, ns.length - selection.location))
            )
            let newDoc = ns.replacingCharacters(in: safe, with: action.text)
            documentText = newDoc
            selection = NSRange(location: safe.location + (action.text as NSString).length, length: 0)
            messages.append(ChatMessage(role: "system", content: "已替换选中区段（\(safe.length) → \(action.text.count) 字）"))

        case .appendText:
            let needsNewline = !documentText.isEmpty && !documentText.hasSuffix("\n")
            let appended = (needsNewline ? "\n" : "") + action.text
            documentText += appended
            let ns = documentText as NSString
            selection = NSRange(location: ns.length, length: 0)
            messages.append(ChatMessage(role: "system", content: "已追加到末尾（\(action.text.count) 字）"))

        case .rewriteDocument:
            if !skipConfirm {
                rewriteConfirm = action
                return
            }
            documentText = action.text
            selection = NSRange(location: 0, length: 0)
            messages.append(ChatMessage(role: "system", content: "已整篇替换为新版本（\(action.text.count) 字）"))
        }
    }
}
