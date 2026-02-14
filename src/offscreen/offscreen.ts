// Offscreen document: captures tab video via getUserMedia, encodes to H.264,
// and muxes to QuickTime MOV using mediabunny's MediaStreamVideoTrackSource.
// Saves the recording directly to IndexedDB (shared with popup) to avoid
// ArrayBuffer serialization issues with Chrome extension messaging.
// Video only — no audio capture.

import {
  MessageType,
  isExtensionMessage,
  type ExtensionMessage,
  type RecordingConfig,
} from "@/types/messages";
import { saveRecording } from "@/lib/db";
import {
  Output,
  MovOutputFormat,
  BufferTarget,
  MediaStreamVideoTrackSource,
  canEncodeVideo,
} from "mediabunny";

// --- State ---

let mediaStream: MediaStream | null = null;
let output: Output<MovOutputFormat, BufferTarget> | null = null;
let bufferTarget: BufferTarget | null = null;
let startedAt = 0;
let stopping = false;
let tabTitle = "untitled";

// --- Stream acquisition ---

async function acquireStream(streamId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
  });
}

// --- Recording lifecycle ---

async function startRecording(
  streamId: string,
  config: RecordingConfig,
): Promise<void> {
  try {
    if (typeof VideoEncoder === "undefined") {
      throw new Error("WebCodecs VideoEncoder not available in offscreen document");
    }

    const stream = await acquireStream(streamId);
    mediaStream = stream;
    stopping = false;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("No video track available");

    const vs = videoTrack.getSettings();
    const width = vs.width ?? 1920;
    const height = vs.height ?? 1080;

    // Check H.264 encoder support
    const videoOk = await canEncodeVideo("avc", {
      width,
      height,
      bitrate: config.videoBitsPerSecond,
    });
    if (!videoOk) throw new Error("H.264 video encoding not supported");

    console.log(`[offscreen] H.264 avc supported, ${width}x${height}, ${config.videoBitsPerSecond / 1_000_000} Mbps`);

    // Setup muxer — MOV format (QuickTime native) with moov at start
    bufferTarget = new BufferTarget();
    output = new Output({
      format: new MovOutputFormat({ fastStart: "in-memory" }),
      target: bufferTarget,
    });

    // Video source (H.264)
    const videoSource = new MediaStreamVideoTrackSource(
      videoTrack as MediaStreamVideoTrack,
      { codec: "avc", bitrate: config.videoBitsPerSecond },
    );
    videoSource.errorPromise.catch((err) => {
      console.error("[offscreen] Video source error:", err);
    });
    output.addVideoTrack(videoSource, { frameRate: config.fps });

    // Start — frames are captured automatically
    await output.start();

    startedAt = Date.now();

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_STARTED,
      startedAt,
    } satisfies ExtensionMessage).catch(console.error);

    console.log(`[offscreen] Recording started: H.264 MOV, ${width}x${height}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[offscreen] Start error:", err);

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_ERROR,
      code: "MEDIA_STREAM_FAILED",
      message,
    } satisfies ExtensionMessage).catch(console.error);

    cleanup();
  }
}

async function stopRecording(): Promise<void> {
  if (stopping || !output) return;
  stopping = true;

  const durationMs = Date.now() - startedAt;

  try {
    console.log("[offscreen] Finalizing output...");
    await output.finalize();

    // Stop media tracks after finalize (mediabunny requirement)
    mediaStream?.getTracks().forEach((t) => t.stop());

    const buffer = bufferTarget?.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error(`Recording produced no output data (buffer=${buffer?.byteLength ?? "null"} bytes)`);
    }

    const mimeType = "video/quicktime";
    const blob = new Blob([buffer], { type: mimeType });
    console.log(`[offscreen] MOV finalized: ${blob.size} bytes, ${durationMs}ms`);

    // Save directly to IndexedDB (shared with popup) to avoid
    // ArrayBuffer serialization issues in Chrome extension messaging
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const sanitized = tabTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "untitled";
    const filename = `chromerec-${sanitized}-${timestamp}.mov`;

    const recordingId = await saveRecording({
      filename,
      mimeType,
      size: blob.size,
      durationMs,
      createdAt: Date.now(),
      tabTitle,
      blob,
    });

    console.log(`[offscreen] Saved to IndexedDB: id=${recordingId}, ${filename}`);

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_STOPPED,
      recordingId,
      mimeType,
      durationMs,
    } satisfies ExtensionMessage).catch(console.error);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[offscreen] Stop error:", err);

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_ERROR,
      code: "RECORDER_ERROR",
      message: `Failed to finalize recording: ${message}`,
    } satisfies ExtensionMessage).catch(console.error);
  }

  cleanup();
}

function cleanup(): void {
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;
  output = null;
  bufferTarget = null;
  startedAt = 0;
  stopping = false;
}

// --- Message listener ---

chrome.runtime.onMessage.addListener(
  (message: unknown): boolean => {
    if (!isExtensionMessage(message)) return false;

    switch (message.type) {
      case MessageType.STREAM_ID_READY:
        tabTitle = message.tabTitle ?? "untitled";
        startRecording(message.streamId, message.config);
        return false;

      case MessageType.STOP_RECORDING:
        stopRecording();
        return false;

      case MessageType.START_RECORDING:
      case MessageType.GET_STATUS:
      case MessageType.RECORDING_STARTED:
      case MessageType.RECORDING_STOPPED:
      case MessageType.RECORDING_ERROR:
        return false;
    }
  },
);

console.log("[offscreen] Document loaded (H.264 MOV, video only, saves to IndexedDB)");
