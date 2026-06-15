import SwiftUI

struct TrashView: View {
    @State private var notes: [Note] = []
    @State private var isLoading = false
    @State private var showEmptyConfirm = false

    var body: some View {
        Group {
            if isLoading && notes.isEmpty {
                ProgressView("加载中...")
            } else if notes.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "trash")
                        .font(.largeTitle)
                        .foregroundStyle(Color.inkTertiary)
                    Text("垃圾箱为空")
                        .foregroundStyle(Color.inkSecondary)
                }
            } else {
                List {
                    ForEach(notes) { note in
                        TrashRowView(note: note, onRestore: { restore(note) }, onDelete: { permanentDelete(note) })
                    }
                }
            }
        }
        .navigationTitle("垃圾箱")
        .toolbar {
            if !notes.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    Button("清空垃圾箱", role: .destructive) {
                        showEmptyConfirm = true
                    }
                    .foregroundStyle(.red)
                }
            }
        }
        .confirmationDialog("清空垃圾箱？", isPresented: $showEmptyConfirm, titleVisibility: .visible) {
            Button("全部永久删除", role: .destructive) { emptyTrash() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("此操作不可撤销，所有垃圾箱中的笔记将被永久删除")
        }
        .task { await loadTrash() }
    }

    private func loadTrash() async {
        isLoading = true
        do {
            notes = try await APIClient.shared.listTrash()
        } catch {
            print("Load trash failed: \(error)")
        }
        isLoading = false
    }

    private func restore(_ note: Note) {
        Task {
            do {
                _ = try await APIClient.shared.restoreNote(id: note.id)
                await MainActor.run {
                    notes.removeAll { $0.id == note.id }
                    NotificationCenter.default.post(name: .noteCreated, object: nil)
                }
            } catch {
                print("Restore failed: \(error)")
            }
        }
    }

    private func permanentDelete(_ note: Note) {
        Task {
            do {
                try await APIClient.shared.permanentDeleteNote(id: note.id)
                await MainActor.run {
                    notes.removeAll { $0.id == note.id }
                }
            } catch {
                print("Permanent delete failed: \(error)")
            }
        }
    }

    private func emptyTrash() {
        let toDelete = notes
        Task {
            for note in toDelete {
                do {
                    try await APIClient.shared.permanentDeleteNote(id: note.id)
                    await MainActor.run { notes.removeAll { $0.id == note.id } }
                } catch {}
            }
        }
    }
}

private struct TrashRowView: View {
    let note: Note
    let onRestore: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(note.title ?? "无标题")
                .font(.headline)
                .foregroundStyle(Color.ink)
                .lineLimit(1)

            Text(note.aiSummary ?? String(note.content.prefix(100)))
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
                .lineLimit(2)

            HStack {
                if let deletedAt = note.deletedAt {
                    let daysLeft = max(0, 30 - Calendar.current.dateComponents([.day], from: deletedAt, to: Date()).day!)
                    Text("\(daysLeft) 天后自动清理")
                        .font(.caption2)
                        .foregroundStyle(daysLeft <= 7 ? .red : Color.inkTertiary)
                }

                Spacer()

                Button("恢复", action: onRestore)
                    .buttonStyle(.bordered)
                    .controlSize(.mini)

                Button("删除", action: onDelete)
                    .foregroundStyle(.red)
                    .controlSize(.mini)
            }
        }
        .padding(.vertical, 4)
    }
}
