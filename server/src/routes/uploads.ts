import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { AuthRequest } from "../middleware/auth.js";

export const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// allow-list of image mime types → file extension
const ALLOWED_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_TYPES.get(file.mimetype) || "bin";
    cb(null, `${randomUUID()}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported image type"));
    }
  },
});

const router = Router();

// POST /api/uploads/image — multipart/form-data, field name "file"
router.post("/image", upload.single("file"), (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// Convert multer / validation errors into 400s instead of falling through to the 500 handler.
router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (!err) {
    next();
    return;
  }
  res.status(400).json({ error: err.message || "Upload failed" });
});

export { router as uploadsRouter };
