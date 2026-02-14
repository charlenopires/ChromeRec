import { describe, expect, test, mock, beforeEach } from "bun:test";
import { negotiateCodec } from "../src/lib/codec";

// Mock MediaRecorder globally
const mockIsTypeSupported = mock(() => false);

// @ts-expect-error — MediaRecorder doesn't exist in bun test env
globalThis.MediaRecorder = {
  isTypeSupported: mockIsTypeSupported,
};

beforeEach(() => {
  mockIsTypeSupported.mockReset();
});

describe("negotiateCodec", () => {
  test("selects VP9 + Opus when supported", () => {
    mockIsTypeSupported.mockImplementation(
      (type: string) => type === "video/webm;codecs=vp9,opus",
    );
    const result = negotiateCodec();
    expect(result.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(result.label).toBe("VP9 + Opus");
    expect(result.hasAudioCodec).toBe(true);
  });

  test("falls back to VP9 when Opus unavailable", () => {
    mockIsTypeSupported.mockImplementation(
      (type: string) => type === "video/webm;codecs=vp9",
    );
    const result = negotiateCodec();
    expect(result.mimeType).toBe("video/webm;codecs=vp9");
    expect(result.hasAudioCodec).toBe(false);
  });

  test("falls back to VP8 + Opus", () => {
    mockIsTypeSupported.mockImplementation(
      (type: string) => type === "video/webm;codecs=vp8,opus",
    );
    const result = negotiateCodec();
    expect(result.mimeType).toBe("video/webm;codecs=vp8,opus");
    expect(result.label).toBe("VP8 + Opus");
  });

  test("falls back to VP8", () => {
    mockIsTypeSupported.mockImplementation(
      (type: string) => type === "video/webm;codecs=vp8",
    );
    const result = negotiateCodec();
    expect(result.mimeType).toBe("video/webm;codecs=vp8");
  });

  test("falls back to plain WebM", () => {
    mockIsTypeSupported.mockImplementation(
      (type: string) => type === "video/webm",
    );
    const result = negotiateCodec();
    expect(result.mimeType).toBe("video/webm");
    expect(result.label).toBe("WebM (default)");
  });

  test("throws when no codec is supported", () => {
    mockIsTypeSupported.mockReturnValue(false);
    expect(() => negotiateCodec()).toThrow("No supported video codec found");
  });

  test("prefers VP9+Opus over VP8+Opus when both supported", () => {
    mockIsTypeSupported.mockImplementation(
      (type: string) =>
        type === "video/webm;codecs=vp9,opus" ||
        type === "video/webm;codecs=vp8,opus",
    );
    const result = negotiateCodec();
    expect(result.mimeType).toBe("video/webm;codecs=vp9,opus");
  });
});
