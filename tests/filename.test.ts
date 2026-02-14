import { describe, expect, test } from "bun:test";
import { generateFilename, sanitizeTitle } from "../src/lib/filename";

describe("sanitizeTitle", () => {
  test("lowercases and replaces special characters", () => {
    expect(sanitizeTitle("My Page Title")).toBe("my-page-title");
  });

  test("collapses multiple hyphens", () => {
    expect(sanitizeTitle("foo---bar")).toBe("foo-bar");
  });

  test("trims leading and trailing hyphens", () => {
    expect(sanitizeTitle("---hello---")).toBe("hello");
  });

  test("handles special characters", () => {
    expect(sanitizeTitle("Hello, World! (2025)")).toBe("hello-world-2025");
  });

  test("limits length to 50 characters", () => {
    const long = "a".repeat(100);
    expect(sanitizeTitle(long).length).toBeLessThanOrEqual(50);
  });

  test("returns 'untitled' for empty string", () => {
    expect(sanitizeTitle("")).toBe("untitled");
  });

  test("returns 'untitled' for only special characters", () => {
    expect(sanitizeTitle("!!!@@@###")).toBe("untitled");
  });
});

describe("generateFilename", () => {
  const date = new Date("2025-02-14T12:30:00Z");

  test("produces .mp4 for MP4 mime type", () => {
    const result = generateFilename("My Page", "video/mp4;codecs=avc1,mp4a.40.2", date);
    expect(result).toBe("chromerec-my-page-2025-02-14T12-30-00.mp4");
  });

  test("produces .webm for WebM mime type", () => {
    const result = generateFilename("My Page", "video/webm;codecs=vp9,opus", date);
    expect(result).toBe("chromerec-my-page-2025-02-14T12-30-00.webm");
  });

  test("defaults to .webm when no mime type given", () => {
    const result = generateFilename("My Page", undefined, date);
    expect(result).toBe("chromerec-my-page-2025-02-14T12-30-00.webm");
  });

  test("handles empty title", () => {
    const result = generateFilename("", "video/mp4", date);
    expect(result).toBe("chromerec-untitled-2025-02-14T12-30-00.mp4");
  });

  test("sanitizes special characters in title", () => {
    const result = generateFilename("Google: Search Results (1/10)", "video/mp4", date);
    expect(result).toBe("chromerec-google-search-results-1-10-2025-02-14T12-30-00.mp4");
  });

  test("starts with chromerec- prefix", () => {
    const result = generateFilename("test");
    expect(result).toStartWith("chromerec-");
  });
});
