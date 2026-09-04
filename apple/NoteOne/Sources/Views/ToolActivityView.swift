import SwiftUI

/// Renders one Notty tool invocation as a compact, collapsible row in the chat flow —
/// icon + localized name + key argument + running/done status; tap to peek at the result.
struct ToolActivityRow: View {
    let activity: ToolActivity
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: iconName)
                        .font(.caption2)
                        .foregroundStyle(Color.accent)
                        .frame(width: 14)

                    Text(displayName)
                        .font(.caption)
                        .foregroundStyle(Color.inkSecondary)

                    if let summary = activity.argsSummary, !summary.isEmpty {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(Color.inkTertiary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }

                    Spacer(minLength: 4)

                    if activity.isRunning {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        if let ms = activity.durationMs {
                            Text(String(format: "%.1fs", Double(ms) / 1000))
                                .font(.caption2)
                                .foregroundStyle(Color.inkTertiary)
                        }
                        Image(systemName: "checkmark")
                            .font(.caption2)
                            .foregroundStyle(Color.success)
                    }

                    if hasPreview {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 8))
                            .foregroundStyle(Color.inkTertiary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded, let preview = activity.resultPreview, !preview.isEmpty {
                Text(preview)
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
                    .lineLimit(8)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.canvasSecondary.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var hasPreview: Bool {
        guard let preview = activity.resultPreview else { return false }
        return !preview.isEmpty
    }

    private var iconName: String {
        switch activity.name {
        case "search_notes", "search_files", "search_web", "search_wechat_mp":
            return "magnifyingglass"
        case "read_note", "read_file", "get_newlore_report", "list_newlore_reports":
            return "doc.text"
        case "web_fetch":
            return "globe"
        case "run_command":
            return "terminal"
        case "list_files":
            return "folder"
        case "schedule_task", "list_scheduled_tasks", "cancel_scheduled_task":
            return "clock"
        case "start_newlore_supplement", "run_newlore_modules", "get_newlore_status":
            return "sparkles"
        case "add_wechat_mp", "remove_wechat_mp", "list_wechat_mps":
            return "bubble.left.and.bubble.right"
        case "add_blog_source", "remove_blog_source", "list_blog_sources":
            return "dot.radiowaves.left.and.right"
        case "get_newlore_config", "update_newlore_config", "get_newlore_preferences", "update_newlore_preferences":
            return "gearshape"
        default:
            return "wrench.and.screwdriver"
        }
    }

    private var displayName: String {
        switch activity.name {
        case "read_note": return L("读取笔记", "Read note")
        case "search_notes": return L("搜索笔记", "Search notes")
        case "web_fetch": return L("抓取网页", "Fetch webpage")
        case "search_web": return L("联网搜索", "Web search")
        case "run_command": return L("执行命令", "Run command")
        case "search_files": return L("搜索文件", "Search files")
        case "list_files": return L("列出文件", "List files")
        case "read_file": return L("读取文件", "Read file")
        case "schedule_task": return L("创建定时任务", "Schedule task")
        case "list_scheduled_tasks": return L("查看定时任务", "List scheduled tasks")
        case "cancel_scheduled_task": return L("取消定时任务", "Cancel scheduled task")
        case "start_newlore_supplement": return L("补充新知", "Update NewLore")
        case "run_newlore_modules": return L("运行新知模块", "Run NewLore modules")
        case "get_newlore_status": return L("查看新知状态", "NewLore status")
        case "list_newlore_reports": return L("新知报告列表", "List NewLore reports")
        case "get_newlore_report": return L("读取新知报告", "Read NewLore report")
        case "delete_newlore_report": return L("删除新知报告", "Delete NewLore report")
        case "list_wechat_mps": return L("公众号列表", "List WeChat accounts")
        case "search_wechat_mp": return L("搜索公众号", "Search WeChat accounts")
        case "add_wechat_mp": return L("添加公众号", "Add WeChat account")
        case "remove_wechat_mp": return L("移除公众号", "Remove WeChat account")
        case "list_blog_sources": return L("博客源列表", "List blog sources")
        case "add_blog_source": return L("添加博客源", "Add blog source")
        case "remove_blog_source": return L("移除博客源", "Remove blog source")
        case "get_newlore_config": return L("查看新知配置", "Get NewLore config")
        case "update_newlore_config": return L("更新新知配置", "Update NewLore config")
        case "get_newlore_preferences": return L("查看新知偏好", "Get NewLore preferences")
        case "update_newlore_preferences": return L("更新新知偏好", "Update NewLore preferences")
        default: return activity.name
        }
    }
}
