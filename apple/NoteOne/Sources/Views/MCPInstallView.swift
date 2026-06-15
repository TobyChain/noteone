import SwiftUI
#if os(macOS)
import AppKit
#endif

#if os(macOS)
struct MCPInstallView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var authService: AuthService
    @AppStorage("mcpServerPath") private var serverPath = ""
    @State private var statusMessage: String?
    @State private var isError = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Image(systemName: "puzzlepiece.extension.fill")
                    .font(.title2)
                    .foregroundStyle(Color.accent)
                Text("MCP 一键安装")
                    .font(.title2.bold())
            }

            Text("将 NoteOne 笔记能力暴露为 MCP 工具，供 Claude Code、Cursor 等 AI Agent 直接读写你的笔记。")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 6) {
                Text("Server 路径")
                    .font(.headline)
                HStack {
                    TextField("/path/to/noteone/server", text: $serverPath)
                        .textFieldStyle(.roundedBorder)
                    #if os(macOS)
                    Button("选择…") { pickFolder() }
                    #endif
                }
            }

            Divider()

            VStack(spacing: 12) {
                installRow(
                    title: "Claude Code",
                    subtitle: "写入 ~/.claude/settings.json",
                    icon: "terminal",
                    buttonLabel: "安装",
                    action: installClaudeCode
                )
                installRow(
                    title: "Cursor",
                    subtitle: "写入 ~/.cursor/mcp.json",
                    icon: "cursorarrow.click",
                    buttonLabel: "安装",
                    action: installCursor
                )
                installRow(
                    title: "复制配置 JSON",
                    subtitle: "适用于 VS Code、Gemini CLI 等",
                    icon: "doc.on.clipboard",
                    buttonLabel: "复制",
                    action: copyConfig
                )
            }

            if let msg = statusMessage {
                HStack(spacing: 6) {
                    Image(systemName: isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(isError ? .red : .green)
                    Text(msg)
                        .font(.callout)
                }
                .transition(.opacity)
            }

            Spacer()

            HStack {
                Spacer()
                Button("关闭") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 480, height: 440)
        .animation(.easeInOut(duration: 0.2), value: statusMessage)
    }

    @ViewBuilder
    private func installRow(title: String, subtitle: String, icon: String, buttonLabel: String, action: @escaping () -> Void) -> some View {
        HStack {
            Image(systemName: icon)
                .frame(width: 24)
                .foregroundStyle(Color.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.bold())
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button(buttonLabel, action: action)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(10)
        .background(Color.canvasSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Actions

    #if os(macOS)
    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "选择 NoteOne Server 目录（包含 .env 的目录）"
        if panel.runModal() == .OK, let url = panel.url {
            serverPath = url.path(percentEncoded: false)
        }
    }
    #endif

    private func buildServerConfig() -> [String: Any]? {
        guard !serverPath.isEmpty else {
            showStatus("请先选择 Server 路径", error: true)
            return nil
        }

        let envPath = (serverPath as NSString).appendingPathComponent(".env")
        guard FileManager.default.fileExists(atPath: envPath) else {
            showStatus("未找到 .env 文件，请确认路径正确", error: true)
            return nil
        }

        let envVars = readEnvFile(at: envPath)
        var env: [String: String] = [:]
        if let v = envVars["DATABASE_URL"] { env["DATABASE_URL"] = v }
        if let v = envVars["QWEN_API_KEY"] { env["QWEN_API_KEY"] = v }
        if let v = envVars["QWEN_BASE_URL"] { env["QWEN_BASE_URL"] = v }
        if let userId = authService.userId {
            env["MCP_USER_ID"] = userId
        }

        return [
            "command": "npx",
            "args": ["tsx", "src/mcp.ts"],
            "cwd": serverPath,
            "env": env,
        ]
    }

    private func installClaudeCode() {
        guard let config = buildServerConfig() else { return }
        let dir = FileManager.default.homeDirectoryForCurrentUser.path + "/.claude"
        let path = dir + "/settings.json"
        writeConfig(at: path, rootKey: "mcpServers", serverName: "noteone", config: config, ensureDir: dir)
    }

    private func installCursor() {
        guard let config = buildServerConfig() else { return }
        let dir = FileManager.default.homeDirectoryForCurrentUser.path + "/.cursor"
        let path = dir + "/mcp.json"
        writeConfig(at: path, rootKey: "mcpServers", serverName: "noteone", config: config, ensureDir: dir)
    }

    private func copyConfig() {
        guard let config = buildServerConfig() else { return }
        let wrapper: [String: Any] = ["mcpServers": ["noteone": config]]
        guard let data = try? JSONSerialization.data(withJSONObject: wrapper, options: [.prettyPrinted, .sortedKeys]),
              let json = String(data: data, encoding: .utf8) else {
            showStatus("JSON 序列化失败", error: true)
            return
        }
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(json, forType: .string)
        #endif
        showStatus("配置已复制到剪贴板", error: false)
    }

    // MARK: - Helpers

    private func writeConfig(at path: String, rootKey: String, serverName: String, config: [String: Any], ensureDir: String) {
        let fm = FileManager.default
        do {
            try fm.createDirectory(atPath: ensureDir, withIntermediateDirectories: true)
        } catch {
            showStatus("无法创建目录: \(error.localizedDescription)", error: true)
            return
        }

        var root: [String: Any] = [:]
        if let data = fm.contents(atPath: path),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            root = existing
        }

        var servers = root[rootKey] as? [String: Any] ?? [:]
        servers[serverName] = config
        root[rootKey] = servers

        guard let data = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys]) else {
            showStatus("JSON 序列化失败", error: true)
            return
        }

        do {
            try data.write(to: URL(fileURLWithPath: path))
            showStatus("已安装到 \(path)", error: false)
        } catch {
            showStatus("写入失败: \(error.localizedDescription)", error: true)
        }
    }

    private func readEnvFile(at path: String) -> [String: String] {
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return [:] }
        var result: [String: String] = [:]
        for line in content.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let parts = trimmed.split(separator: "=", maxSplits: 1)
            if parts.count == 2 {
                result[String(parts[0])] = String(parts[1])
            }
        }
        return result
    }

    private func showStatus(_ message: String, error: Bool) {
        isError = error
        statusMessage = message
    }
}

#endif
