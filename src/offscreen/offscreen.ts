// Offscreen document: captures tab via getUserMedia, encodes to H.264/AAC,
// and muxes to proper MP4 using mediabunny's MediaStream sources.
// This produces a QuickTime-compatible MP4 with moov at the start.

import {
  MessageType,
  isExtensionMessage,
  type ExtensionMessage,
  type RecordingConfig,
} from "@/types/messages";
import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  MediaStreamVideoTrackSource,
  MediaStreamAudioTrackSource,
} from "mediabunny";

// --- State ---

let mediaStream: MediaStream | null = null;
let muxerOutput: Output<Mp4OutputFormat, BufferTarget> | null = null;
let videoSource: MediaStreamVideoTrackSource | null = null;
let audioSource: MediaStreamAudioTrackSource | null = null;
let bufferTarget: BufferTarget | null = null;
let startedAt = 0;
let stopping = false;

// --- Stream acquisition ---

async function acquireStream(streamId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
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
}

// --- Recording lifecycle ---

async function startRecording(
  streamId: string,
  config: RecordingConfig,
): Promise<void> {
  try {
    const stream = await acquireStream(streamId);
    mediaStream = stream;
    stopping = false;

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    if (!videoTrack) throw new Error("No video track available");

    // mediabunny sources handle WebCodecs encoding + timestamp sync internally
    videoSource = new MediaStreamVideoTrackSource(
      videoTrack as MediaStreamVideoTrack,
      { codec: "avc", bitrate: config.videoBitsPerSecond },
    );

    videoSource.errorPromise.catch((err) =>
      console.error("[offscreen] Video source error:", err),
    );

    if (audioTrack) {
      audioSource = new MediaStreamAudioTrackSource(
        audioTrack as MediaStreamAudioTrack,
        { codec: "aac", bitrate: 128_000 },
      );

      audioSource.errorPromise.catch((err) =>
        console.error("[offscreen] Audio source error:", err),
      );
    }

    // Setup muxer — moov at start for QuickTime compatibility
    bufferTarget = new BufferTarget();
    muxerOutput = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: bufferTarget,
    });

    muxerOutput.addVideoTrack(videoSource);
    if (audioSource) muxerOutput.addAudioTrack(audioSource);

    // Frames are captured automatically once started
    await muxerOutput.start();

    startedAt = Date.now();
    const vs = videoTrack.getSettings();

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_STARTED,
      startedAt,
    } satisfies ExtensionMessage).catch(console.error);

    console.log(
      `[offscreen] Recording started: H.264/AAC, ${vs.width}x${vs.height}, ${config.videoBitsPerSecond / 1_000_000} Mbps`,
    );
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
  if (stopping || !muxerOutput) return;
  stopping = true;

  const durationMs = Date.now() - startedAt;

  try {
    // Close sources (stops frame capture, flushes encoders)
    videoSource?.close();
    audioSource?.close();

    // Finalize MP4 (writes moov atom at start)
    await muxerOutput.finalize();

    // Stop media tracks
    mediaStream?.getTracks().forEach((t) => t.stop());

    const buffer = bufferTarget?.buffer;
    if (buffer && buffer.byteLength > 0) {
      console.log(`[offscreen] MP4 finalized: ${buffer.byteLength} bytes, ${durationMs}ms`);

      chrome.runtime.sendMessage({
        type: MessageType.RECORDING_STOPPED,
        chunks: [buffer],
        mimeType: "video/mp4",
        durationMs,
      } satisfies ExtensionMessage).catch(console.error);
    } else {
      throw new Error("Recording produced no output data");
    }
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
  muxerOutput = null;
  videoSource = null;
  audioSource = null;
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

console.log("[offscreen] Document loaded (mediabunny MediaStream sources)");
