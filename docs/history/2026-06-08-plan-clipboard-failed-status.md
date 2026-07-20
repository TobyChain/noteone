# Plan: Clipboard Image Support + Failed Note Status

## Context

Two issues to fix:

1. **Clipboard images can't be saved**: `captureSelectedText()` and `pasteFromClipboard()` only read `NSPasteboard.general.string(forType: .string)` — pure text. No image detection, no upload endpoint, no image storage infrastructure exists.

2. **Empty/unfetchable content shows AI response instead of "生成失败"**: When a note's URL can't be fetched and content is minimal, or when AI enrichment fails, the note either gets a low-quality AI response or stays stuck in `pending_ai` forever. It should show a clear "生成失败" failure state.

---

## Part 1: Add `failed` Status for Notes

### 1.1 Database — add `failed` to status enum
**File:** `server/src/db/schema.ts`
- Add `"failed"` to `noteStatusEnum`
- Generate migration: `ALTER TYPE note_status ADD VALUE 'failed'`

### 1.2 Server pipeline — detect failure and mark notes
**File:** `server/src/services/pipeline.ts`
- After URL fetch fails: check if the original content is effectively just the URL or very short (< 10 chars of meaningful text). If so, set status to `failed` and return early with aiSummary = "内容获取失败，请检查链接或重新输入".
- Wrap enrichment: if it rejects, catch and set `status = 'failed'` with aiSummary = "AI 处理失败".

### 1.3 Swift client — add `failed` case
**File:** `apple/NoteOne/Sources/Models/Note.swift`
- Add `case failed` to `NoteStatus` enum.

### 1.4 Client UI — show failure state
**File:** `apple/NoteOne/Sources/Views/NoteDetailView.swift`
- Add `FailedBanner` component with "生成失败" message and "重试" button.
- Show for `note.status == .failed`.

**File:** `apple/NoteOne/Sources/Views/NoteListView.swift`
- In `NoteRowView`: show failure indicator (exclamationmark.triangle) for failed status.

### 1.5 Server — retry endpoint
**File:** `server/src/routes/notes.ts`
- Add `POST /api/notes/:id/retry`: resets status to `pending_ai`, re-runs `processNote()`.

**File:** `apple/NoteOne/Sources/Services/APIClient.swift`
- Add `retryNote(id:)` method.

---

## Part 2: Clipboard Image Support

### 2.1 Server — image upload endpoint + static serving
**File:** `server/src/routes/uploads.ts` (new)
- `POST /api/uploads/image` — multipart/form-data, saves to `server/uploads/` with UUID filename.
- Returns `{ url: "/uploads/<uuid>.<ext>" }`.

**File:** `server/src/index.ts`
- `express.static` for `/uploads`, register uploads router.

### 2.2 Swift client — detect clipboard images
**File:** `apple/NoteOne/Sources/macOS/HotkeyManager.swift`
- Also check for image types (`.png`, `.tiff`) after synthetic Cmd+C.
- Return `CapturedContent` enum: `.text(String)` or `.image(Data)`.

### 2.3 CaptureView image handling
**File:** `apple/NoteOne/Sources/Views/CaptureView.swift`
- Add `@State private var imageData: Data?`.
- Show image preview, upload on save, create note with `contentType: "image"`.
- `pasteFromClipboard()`: check for images too.

### 2.4 API client upload
**File:** `apple/NoteOne/Sources/Services/APIClient.swift`
- Add `uploadImage(data:) async throws -> String` with multipart/form-data.

---

## Verification
1. Create note with bad URL → shows "生成失败", retry works.
2. Copy image → Cmd+Shift+N → image preview → save → note with image type.
3. Build macOS + iOS clean.
