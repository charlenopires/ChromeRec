// Type-safe message passing between popup, service worker, and offscreen document.
// Uses discriminated unions keyed on `type` for exhaustive pattern matching.

export const MessageType = {
  START_RECORDING: "START_RECORDING",
  STOP_RECORDING: "STOP_RECORDING",
  GET_STATUS: "GET_STATUS",
  RECORDING_STARTED: "RECORDING_STARTED",
  RECORDING_STOPPED: "RECORDING_STOPPED",
  RECORDING_ERROR: "RECORDING_ERROR",
  STREAM_ID_READY: "STREAM_ID_READY",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// --- Recording configuration ---

export interface RecordingConfig {
  readonly fps: 30 | 60;
  readonly videoBitsPerSecond: number;
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  fps: 30,
  videoBitsPerSecond: 2_500_000,
};

// --- Error codes ---

export type RecordingErrorCode =
  | "TAB_CAPTURE_FAILED"
  | "OFFSCREEN_CREATE_FAILED"
  | "MEDIA_STREAM_FAILED"
  | "CODEC_NOT_SUPPORTED"
  | "RECORDER_ERROR"
  | "UNKNOWN";

// --- Message types (discriminated union on `type`) ---

export interface StartRecordingMessage {
  readonly type: typeof MessageType.START_RECORDING;
  readonly config?: Partial<RecordingConfig>;
}

export interface StopRecordingMessage {
  readonly type: typeof MessageType.STOP_RECORDING;
}

export interface GetStatusMessage {
  readonly type: typeof MessageType.GET_STATUS;
}

export interface StreamIdReadyMessage {
  readonly type: typeof MessageType.STREAM_ID_READY;
  readonly streamId: string;
  readonly config: RecordingConfig;
}

export interface RecordingStartedMessage {
  readonly type: typeof MessageType.RECORDING_STARTED;
  readonly startedAt: number;
}

export interface RecordingStoppedMessage {
  readonly type: typeof MessageType.RECORDING_STOPPED;
  readonly chunks: ArrayBuffer[];
  readonly mimeType: string;
  readonly durationMs: number;
}

export interface RecordingErrorMessage {
  readonly type: typeof MessageType.RECORDING_ERROR;
  readonly code: RecordingErrorCode;
  readonly message: string;
}

export type ExtensionMessage =
  | StartRecordingMessage
  | StopRecordingMessage
  | GetStatusMessage
  | StreamIdReadyMessage
  | RecordingStartedMessage
  | RecordingStoppedMessage
  | RecordingErrorMessage;

// --- Response types for sendResponse callbacks ---

export interface StatusResponse {
  readonly isRecording: boolean;
  readonly startedAt: number | null;
  readonly tabId: number | null;
}

export interface AckResponse {
  readonly ok: boolean;
  readonly error?: string;
}

// --- Type guard ---

const MESSAGE_TYPES = new Set<string>(Object.values(MessageType));

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as Record<string, unknown>).type === "string" &&
    MESSAGE_TYPES.has((value as Record<string, unknown>).type as string)
  );
}
