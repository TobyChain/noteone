# macOS 发布

正式 DMG 必须使用同一张 `Developer ID Application` 证书签名，并通过 Apple 公证。`scripts/package-dmg.sh` 在证书、公证凭据、稳定 Team ID 或 Gatekeeper 校验缺失时直接失败，不会降级生成 ad-hoc 发布包。

## 一次性准备

需要有效的 Apple Developer Program 账号，并准备以下内容：

- 从钥匙串导出的 Developer ID Application 证书和私钥，格式为 PKCS#12（`.p12`）。
- App Store Connect API 私钥（`.p8`）。
- API Key ID。
- API Issuer ID。

在仓库根目录设置 GitHub Actions Secrets：

```bash
base64 -i DeveloperIDApplication.p12 | gh secret set MACOS_CERTIFICATE_P12_BASE64
gh secret set MACOS_CERTIFICATE_PASSWORD
base64 -i AuthKey_KEYID.p8 | gh secret set APP_STORE_CONNECT_API_KEY_P8_BASE64
gh secret set APP_STORE_CONNECT_KEY_ID
gh secret set APP_STORE_CONNECT_ISSUER_ID
```

密码和 ID 命令会进入交互输入，不要把值写进命令行或仓库。

## 本机构建

先把 Developer ID 证书及私钥导入登录钥匙串，再为 `notarytool` 保存凭据：

```bash
xcrun notarytool store-credentials noteone-notary \
  --key AuthKey_KEYID.p8 \
  --key-id KEYID \
  --issuer ISSUER_ID
```

使用钥匙串中的完整证书名称构建：

```bash
export NOTEONE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export NOTEONE_NOTARY_KEYCHAIN_PROFILE='noteone-notary'
./scripts/package-dmg.sh dist
```

脚本依次执行应用构建、内嵌 Node 签名、带 Apple Events 权限的 App 签名、DMG 签名、公证、staple 和 Gatekeeper 校验。Node 使用单独的 Hardened Runtime entitlement 保留 V8 JIT 能力。Apple Events entitlement 用于用户主动开启的浏览器 URL 和标题读取；选中文字仍由 macOS 辅助功能权限控制。

## Developer ID 暂不可用时

只为本机生成明确标记的临时包：

```bash
./scripts/package-dmg.sh --local dist-local
```

产物名为 `NoteOne-local.dmg`。该模式保留 Node.js 官方签名，只对外层 App 和 DMG 做 ad-hoc 签名，不进行公证，也不会被正式发布 workflow 使用。每次替换 App 后都要重新授予辅助功能权限：

```bash
osascript -e 'tell application id "com.noteone.app" to quit'
tccutil reset Accessibility com.noteone.app
open /Applications/NoteOne.app
```

随后进入“NoteOne → 设置 → 快捷键与权限”点击“请求权限”。

## 临时签名预览版

经过明确选择后，可以将本地构建作为 GitHub 预览版发布。使用 `vX.Y.Z-preview.N` 标签并启用 `prerelease`，安装包命名为 `NoteOne-preview.dmg`，同时提供对应的 SHA-256 文件。正式发布 workflow 跳过这些预览标签，正式 DMG 继续要求 Developer ID 签名与 Apple 公证。

预览版发布说明必须写明 ad-hoc 签名、尚未进行 Apple 公证、首次打开的系统确认方式，以及覆盖安装后重新授予辅助功能权限的步骤。预览版保持独立下载入口，Homebrew 继续提供最近的正式版本。

## 发布验证

```bash
codesign --verify --deep --strict --verbose=2 /Applications/NoteOne.app
codesign -dr - /Applications/NoteOne.app
xcrun stapler validate dist/NoteOne.dmg
spctl --assess --type open --context context:primary-signature --verbose=2 dist/NoteOne.dmg
```

`codesign -dr -` 的结果必须由固定 Team ID 和证书约束组成，不能退化为仅绑定当前二进制的 `cdhash`。从旧 ad-hoc 版本升级到首个 Developer ID 版本时需要重新授予一次辅助功能权限；之后使用同一证书覆盖安装，macOS 会继续识别同一个应用身份。
