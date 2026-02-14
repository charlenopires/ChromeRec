// Offscreen document: runs MediaRecorder to capture tab audio/video.
// Receives stream ID from service worker, captures media, sends back ArrayBuffer chunks.

import {
  MessageType,
  isExtensionMessage,
  type ExtensionMessage,
  type RecordingConfig,
} from "@/types/messages";
import { negotiateCodec } from "@/lib/codec";

// --- State ---

let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;

// --- Stream acquisition ---

async function acquireStream(streamId: string): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
  });
  return stream;
}

// --- Recording lifecycle ---

async function startRecording(
  streamId: string,
  config: RecordingConfig,
): Promise<void> {
  try {
    const codec = negotiateCodec();
    const stream = await acquireStream(streamId);
    mediaStream = stream;
    chunks = [];

    const recorder = new MediaRecorder(stream, {
      mimeType: codec.mimeType,
      videoBitsPerSecond: config.videoBitsPerSecond,
    });

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const durationMs = Date.now() - startedAt;

      // Convert Blob[] → ArrayBuffer[] for structured-cloneable transfer
      const buffers = await Promise.all(
        chunks.map((chunk) => chunk.arrayBuffer()),
      );

      chrome.runtime.sendMessage({
        type: MessageType.RECORDING_STOPPED,
        chunks: buffers,
        mimeType: codec.mimeType,
        durationMs,
      } satisfies ExtensionMessage).catch(console.error);

      cleanup();
    };

    recorder.onerror = () => {
      chrome.runtime.sendMessage({
        type: MessageType.RECORDING_ERROR,
        code: "RECORDER_ERROR",
        message: "MediaRecorder encountered an error",
      } satisfies ExtensionMessage).catch(console.error);

      cleanup();
    };

    // 1-second timeslice for chunked recording
    recorder.start(1000);
    mediaRecorder = recorder;
    startedAt = Date.now();

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_STARTED,
      startedAt,
    } satisfies ExtensionMessage).catch(console.error);

    console.log(
      `[offscreen] Recording started: ${codec.label}, ${config.videoBitsPerSecond / 1_000_000} Mbps`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const code = message.includes("codec")
      ? ("CODEC_NOT_SUPPORTED" as const)
      : ("MEDIA_STREAM_FAILED" as const);

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_ERROR,
      code,
      message,
    } satisfies ExtensionMessage).catch(console.error);

    cleanup();
  }
}

function stopRecording(): void {
  // Idempotent: guards against double-stop from broadcast
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  mediaRecorder.stop();
}

function cleanup(): void {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  mediaRecorder = null;
  chunks = [];
  startedAt = 0;
}

// --- Message listener ---

chrome.runtime.onMessage.addListener(
  (message: unknown): boolean => {
    if (!isExtensionMessage(message)) return false;

    const msg: ExtensionMessage = message;

    switch (msg.type) {
      case MessageType.STREAM_ID_READY: {
        startRecording(msg.streamId, msg.config);
        return false;
      }

      case MessageType.STOP_RECORDING: {
        stopRecording();
        return false;
      }

      // Messages not handled by offscreen document
      case MessageType.START_RECORDING:
      case MessageType.GET_STATUS:
      case MessageType.RECORDING_STARTED:
      case MessageType.RECORDING_STOPPED:
      case MessageType.RECORDING_ERROR:
        return false;
    }
  },
);

console.log("[offscreen] Document loaded");
