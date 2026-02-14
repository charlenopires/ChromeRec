// Auto-generate download filenames from tab title, mime type, and timestamp.

export function generateFilename(
  tabTitle: string,
  mimeType: string = "video/webm",
  date: Date = new Date(),
): string {
  const sanitized = sanitizeTitle(tabTitle);
  const timestamp = date.toISOString().slice(0, 19).replace(/:/g, "-");
  const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  return `chromerec-${sanitized}-${timestamp}.${ext}`;
}

export function sanitizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // Replace non-alphanumeric with hyphens
    .replace(/-+/g, "-")           // Collapse multiple hyphens
    .replace(/^-|-$/g, "")         // Trim leading/trailing hyphens
    .slice(0, 50)                  // Limit length
    || "untitled";
}
