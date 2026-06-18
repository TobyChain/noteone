import SwiftUI

/// Stateless markdown editor pane: displays editor / preview / split for a single
/// document. File IO and selection logic are owned by the parent — this view only
/// renders, edits, and bubbles change events through bindings.
struct WriterEditorPane: View {
    var fileTitle: String
    @Binding var content: String
    @Binding var selection: NSRange
    var lastSavedAt: Date?
    var onRename: () -> Void
    var onDelete: () -> Void
    var onContentChange: () -> Void

    @State private var displayMode: DisplayMode = .edit

    enum DisplayMode: String, CaseIterable {
        case edit = "编辑"
        case preview = "预览"
        case split = "并排"
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            switch displayMode {
            case .edit:
                editor
            case .preview:
                previewArea
            case .split:
                #if os(macOS)
                HStack(spacing: 0) {
                    editor
                    Divider()
                    previewArea
                }
                #else
                editor
                #endif
            }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 12) {
            Text(fileTitle)
                .font(.headline)
                .foregroundStyle(Color.ink)
                .lineLimit(1)
            Spacer(minLength: 12)
            Picker("", selection: $displayMode) {
                ForEach(availableModes, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: macOSToolbarWidth)
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
                    .foregroundStyle(.red)
            }
            .help("删除")
        }
        .padding(8)
    }

    private var editor: some View {
        SelectionAwareTextView(text: $content, selection: $selection)
            .onChange(of: content) { _, _ in onContentChange() }
    }

    private var previewArea: some View {
        ScrollView {
            MarkdownPreview(markdown: content)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var availableModes: [DisplayMode] {
        #if os(macOS)
        return DisplayMode.allCases
        #else
        return [.edit, .preview]
        #endif
    }

    private var macOSToolbarWidth: CGFloat {
        #if os(macOS)
        return 220
        #else
        return 160
        #endif
    }
}
