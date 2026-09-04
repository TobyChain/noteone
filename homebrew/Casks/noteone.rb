cask "noteone" do
  version "0.2.4"
  sha256 "25582d13e457f5b4fb924e58e4f47c43f336e6455d00aec0218f2e3f34440dc6"

  url "https://github.com/TobyChain/noteone/releases/download/v#{version}/NoteOne.dmg"
  name "NoteOne"
  desc "AI 知识管理 · 新知日报 · 闹闹助手"
  homepage "https://github.com/TobyChain/noteone"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :sonoma
  depends_on arch: :arm64

  app "NoteOne.app"

  zap trash: [
    "~/Library/Application Support/NoteOne",
  ]
end
