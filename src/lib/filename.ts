// Auto-generate download filenames from tab title and timestamp.

export function generateFilename(tabTitle: string, date: Date = new Date()): string {
  const sanitized = sanitizeTitle(tabTitle);
  const timestamp = date.toISOString().slice(0, 19).replace(/:/g, "-");
  return `chromerec-${sanitized}-${timestamp}.webm`;
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
