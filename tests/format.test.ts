import { describe, expect, test } from "bun:test";
import { formatDuration, formatSize } from "../src/lib/format";

describe("formatDuration", () => {
  test("formats 0ms as 00:00", () => {
    expect(formatDuration(0)).toBe("00:00");
  });

  test("formats seconds only", () => {
    expect(formatDuration(5_000)).toBe("00:05");
    expect(formatDuration(45_000)).toBe("00:45");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(65_000)).toBe("01:05");
    expect(formatDuration(600_000)).toBe("10:00");
    expect(formatDuration(3_599_000)).toBe("59:59");
  });

  test("formats hours when >= 1 hour", () => {
    expect(formatDuration(3_600_000)).toBe("01:00:00");
    expect(formatDuration(3_661_000)).toBe("01:01:01");
    expect(formatDuration(36_000_000)).toBe("10:00:00");
  });

  test("truncates sub-second precision", () => {
    expect(formatDuration(1_999)).toBe("00:01");
    expect(formatDuration(500)).toBe("00:00");
  });
});

describe("formatSize", () => {
  test("formats bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  test("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1023)).toBe("1023.0 KB");
  });

  test("formats megabytes", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(formatSize(1024 * 1024 * 100)).toBe("100.0 MB");
  });
});
