import { describe, expect, test } from "bun:test";
import { isExtensionMessage, MessageType } from "../src/types/messages";

describe("isExtensionMessage", () => {
  test("returns true for valid START_RECORDING", () => {
    expect(isExtensionMessage({ type: MessageType.START_RECORDING })).toBe(true);
  });

  test("returns true for valid STOP_RECORDING", () => {
    expect(isExtensionMessage({ type: MessageType.STOP_RECORDING })).toBe(true);
  });

  test("returns true for valid GET_STATUS", () => {
    expect(isExtensionMessage({ type: MessageType.GET_STATUS })).toBe(true);
  });

  test("returns true for valid STREAM_ID_READY", () => {
    expect(
      isExtensionMessage({
        type: MessageType.STREAM_ID_READY,
        streamId: "abc",
        config: { fps: 30, videoBitsPerSecond: 2_500_000 },
      }),
    ).toBe(true);
  });

  test("returns true for valid RECORDING_STARTED", () => {
    expect(
      isExtensionMessage({ type: MessageType.RECORDING_STARTED, startedAt: Date.now() }),
    ).toBe(true);
  });

  test("returns true for valid RECORDING_STOPPED", () => {
    expect(
      isExtensionMessage({
        type: MessageType.RECORDING_STOPPED,
        chunks: [],
        mimeType: "video/webm",
        durationMs: 5000,
      }),
    ).toBe(true);
  });

  test("returns true for valid RECORDING_ERROR", () => {
    expect(
      isExtensionMessage({
        type: MessageType.RECORDING_ERROR,
        code: "RECORDER_ERROR",
        message: "something broke",
      }),
    ).toBe(true);
  });

  test("returns false for null", () => {
    expect(isExtensionMessage(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isExtensionMessage(undefined)).toBe(false);
  });

  test("returns false for non-object", () => {
    expect(isExtensionMessage("START_RECORDING")).toBe(false);
    expect(isExtensionMessage(42)).toBe(false);
    expect(isExtensionMessage(true)).toBe(false);
  });

  test("returns false for object without type", () => {
    expect(isExtensionMessage({ foo: "bar" })).toBe(false);
  });

  test("returns false for object with non-string type", () => {
    expect(isExtensionMessage({ type: 123 })).toBe(false);
  });

  test("returns false for object with unknown type string", () => {
    expect(isExtensionMessage({ type: "UNKNOWN_TYPE" })).toBe(false);
  });

  test("returns false for empty object", () => {
    expect(isExtensionMessage({})).toBe(false);
  });
});
