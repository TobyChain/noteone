cask "noteone" do
  version "0.2.0"
  sha256 "ede49fbb09ea63e78d29bfd6692b840d6c0996b8450fda72b157631d5915ac5c"

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
