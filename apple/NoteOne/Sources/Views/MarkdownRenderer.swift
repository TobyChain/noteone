import Foundation

enum MarkdownRenderer {
    static func render(markdown: String, title: String? = nil) -> String {
        let escapedMd = markdown
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "$", with: "\\$")

        return """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>\(title ?? "")</title>
        <style>
        :root {
          --ink:#1a1c2c; --ink-2:#3b3f5c; --ink-3:#6c7395;
          --paper:#fbfaf6; --paper-2:#f3efe5; --line:#e6dfcd;
          --accent:#d96f3a; --accent-2:#7c5cff;
          --mono:'JetBrains Mono',SFMono-Regular,Menlo,Consolas,monospace;
          --sans:-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans SC',sans-serif;
        }
        * { box-sizing:border-box; }
        body { font-family:var(--sans); color:var(--ink); background:var(--paper);
               line-height:1.8; font-size:16px; padding:48px 56px; max-width:980px; margin:0 auto;
               -webkit-font-smoothing:antialiased; }
        h1,h2,h3,h4 { color:var(--ink); line-height:1.4; }
        h1 { font-size:28px; margin:0 0 24px; padding-bottom:10px; border-bottom:2px solid var(--line); }
        h2 { font-size:22px; margin:36px 0 16px; }
        h3 { font-size:18px; margin:24px 0 12px; }
        h4 { font-size:16px; margin:20px 0 8px; }
        p { margin:0 0 14px; }
        code { font-family:var(--mono); background:var(--paper-2); padding:2px 6px; border-radius:4px; font-size:13.5px; }
        pre { padding:18px 20px; background:#fdfcf7; border:1px solid var(--line); border-radius:14px; overflow:auto; margin:16px 0; }
        pre code { background:transparent; padding:0; font-size:13.5px; line-height:1.6; }
        blockquote { margin:16px 0; padding:14px 20px; border-left:3px solid var(--accent); background:rgba(217,111,58,.05); border-radius:0 8px 8px 0; color:var(--ink-2); }
        blockquote p { margin:0; }
        table { width:100%; border-collapse:collapse; margin:16px 0; font-size:14px; }
        th,td { padding:10px 14px; text-align:left; border-bottom:1px solid var(--line); }
        th { background:var(--paper-2); font-weight:600; color:var(--ink); }
        tr:hover { background:var(--paper-2); }
        a { color:var(--accent-2); text-decoration:none; }
        a:hover { text-decoration:underline; }
        img { max-width:100%; border-radius:8px; }
        ul,ol { padding-left:24px; margin:0 0 14px; }
        li { margin:4px 0; }
        hr { border:none; border-top:1px solid var(--line); margin:28px 0; }
        strong { color:var(--ink); }
        </style>
        </head>
        <body>
        <div id="content"></div>
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <script>
        const md = `\(escapedMd)`;
        document.getElementById('content').innerHTML = marked.parse(md);
        </script>
        </body>
        </html>
        """
    }
}
