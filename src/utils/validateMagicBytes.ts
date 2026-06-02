// ──────────────────────── Magic Byte Validation ────────────────────────
// Verifies actual file content, not just the spoofable MIME header.
// Used by both the upload route (for error messaging) and upload controller (deep check).

export function validateMagicBytes(buffer: Buffer, mime: string): boolean {
  // At minimum we need a few bytes to inspect
  if (!buffer || buffer.length < 4) return false;

  const head = buffer;

  // JPEG: starts with FF D8 FF
  if (mime === "image/jpeg") {
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  }

  // PNG: starts with 89 50 4E 47 (‰PNG)
  if (mime === "image/png") {
    return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  }

  // WebP: RIFF header + WEBP at offset 8
  if (mime === "image/webp") {
    if (buffer.length < 12) return false;
    const isRiff =
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
    const isWebp =
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    return isRiff && isWebp;
  }

  // PDF: starts with %PDF (25 50 44 46)
  if (mime === "application/pdf") {
    return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  }

  return false;
}