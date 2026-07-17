import SwiftUI
import UniformTypeIdentifiers

struct WriterEditorPane: View {
    var fileTitle: String
    @Binding var content: String
    @Binding var selection: NSRange
    var lastSavedAt: Date?
    var onRename: () -> Void
    var onDelete: () -> Void
    var onContentChange: () -> Void

    @State private var editorCommand: EditorCommand?
    @State private var showLinkSheet = false
    @State private var showImagePicker = false
    @State private var linkURL: String = ""
    @State private var linkText: String = ""

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            #if os(macOS)
            formatBar
            Divider()
            MarkdownLiveEditor(
                text: $content,
                onContentChange: onContentChange,
                command: editorCommand,
                onCommandHandled: { editorCommand = nil },
                onShortcut: { handle($0) }
            )
            #else
            SelectionAwareTextView(text: $content, selection: $selection)
                .onChange(of: content) { _, _ in onContentChange() }
            #endif
        }
        .id(fileTitle)
        #if os(macOS)
        .fileImporter(isPresented: $showImagePicker, allowedContentTypes: [.image], allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first {
                editorCommand = .insertImage(url.absoluteString)
            }
        }
        .sheet(isPresented: $showLinkSheet) {
            linkSheet
        }
        #endif
    }

    // MARK: - Top toolbar

    private var toolbar: some View {
        HStack(spacing: DG.sp12) {
            Text(fileTitle)
                .font(.headline)
                .foregroundStyle(Color.ink)
                .lineLimit(1)
            Spacer(minLength: DG.sp12)
            if let saved = lastSavedAt {
                Text("已保存 \(saved, format: .relative(presentation: .numeric))")
                    .font(.caption)
                    .foregroundStyle(Color.inkTertiary)
            }
            Button(action: onRename) {
                Image(systemName: "pencil")
            }
            .help("重命名")
            Button(role: .destructive, action: onDelete) {
                Image(systemName: "trash")
                    .foregroundStyle(Color.danger)
            }
            .help("删除")
        }
        .padding(DG.sp8)
    }

    // MARK: - Format bar (macOS Notes-style)

    @ViewBuilder
    private var formatBar: some View {
        #if os(macOS)
        HStack(spacing: DG.sp4) {
            Menu {
                Button("标题 1") { editorCommand = .heading(1) }
                Button("标题 2") { editorCommand = .heading(2) }
                Button("标题 3") { editorCommand = .heading(3) }
                Divider()
                Button("正文") { editorCommand = .heading(0) }
            } label: {
                Image(systemName: "textformat.size")
            }
            .help("标题样式")
            .frame(width: 36, height: 28)

            fmtButton("bold", help: "加粗  ⌘B") { editorCommand = .bold }
            fmtButton("italic", help: "斜体  ⌘I") { editorCommand = .italic }
            fmtButton("monospace", help: "行内代码  ⇧⌘M") { editorCommand = .inlineCode }

            Divider().frame(height: 18)

            fmtButton("list.bullet", help: "无序列表  ⇧⌘7") { editorCommand = .bulletList }
            fmtButton("list.number", help: "有序列表  ⇧⌘9") { editorCommand = .numberedList }
            fmtButton("checklist", help: "核对清单  ⇧⌘L") { editorCommand = .checklist }
            fmtButton("text.quote", help: "引用  ⌘'") { editorCommand = .quote }

            Divider().frame(height: 18)

            fmtButton("tablecells", help: "表格  ⌥⌘T") { editorCommand = .insertTable }
            fmtButton("photo", help: "图片  ⇧⌘A") { showImagePicker = true }
            fmtButton("link", help: "链接  ⌘K") {
                linkURL = ""
                linkText = ""
                showLinkSheet = true
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, DG.sp8)
        .padding(.vertical, DG.sp4)
        #endif
    }

    @ViewBuilder
    private func fmtButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(Color.inkSecondary)
                .frame(width: 30, height: 24)
        }
        .buttonStyle(.borderless)
        .help(help)
    }

    // MARK: - Link sheet

    private var linkSheet: some View {
        VStack(spacing: DG.sp12) {
            Text("插入链接").font(.headline)
            TextField("链接文字（可选）", text: $linkText)
                .textFieldStyle(.roundedBorder)
            TextField("https://", text: $linkURL)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("取消") {
                    showLinkSheet = false
                }
                .keyboardShortcut(.cancelAction)
                Spacer()
                Button("插入") {
                    if !linkURL.isEmpty {
                        editorCommand = .insertLink(text: linkText, url: linkURL)
                    }
                    showLinkSheet = false
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(linkURL.isEmpty)
            }
        }
        .padding(DG.sp20)
        .frame(width: 340)
    }

    // MARK: - Command routing

    private func handle(_ cmd: EditorCommand) {
        switch cmd {
        case .requestLinkDialog:
            linkURL = ""
            linkText = ""
            showLinkSheet = true
        case .requestImagePicker:
            showImagePicker = true
        default:
            editorCommand = cmd
        }
    }
}
