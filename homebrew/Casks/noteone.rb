cask "noteone" do
  version "0.2.4"
  sha256 "e4eedc5788fe20e4a4cb193fb186b744a6d48f64785c539c70c76cebaa9f3d1e"

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
