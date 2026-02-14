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
  test("produces correct format", () => {
    const date = new Date("2025-02-14T12:30:00Z");
    const result = generateFilename("My Page", date);
    expect(result).toBe("chromerec-my-page-2025-02-14T12-30-00.webm");
  });

  test("handles empty title", () => {
    const date = new Date("2025-02-14T12:30:00Z");
    const result = generateFilename("", date);
    expect(result).toBe("chromerec-untitled-2025-02-14T12-30-00.webm");
  });

  test("sanitizes special characters in title", () => {
    const date = new Date("2025-02-14T12:30:00Z");
    const result = generateFilename("Google: Search Results (1/10)", date);
    expect(result).toBe("chromerec-google-search-results-1-10-2025-02-14T12-30-00.webm");
  });

  test("ends with .webm extension", () => {
    const result = generateFilename("test");
    expect(result).toEndWith(".webm");
  });

  test("starts with chromerec- prefix", () => {
    const result = generateFilename("test");
    expect(result).toStartWith("chromerec-");
  });
});
