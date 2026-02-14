// Offscreen document: uses WebCodecs (H.264/AAC) + mediabunny muxer to produce
// a proper MP4 file directly from the tab capture stream. This bypasses MediaRecorder
// entirely, avoiding its fragmented MP4 / broken WebM duration issues.

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
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from "mediabunny";

// Chrome 94+ but lacks TS types
declare class MediaStreamTrackProcessor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(init: { track: any });
  readonly readable: ReadableStream;
}

// --- State ---

let mediaStream: MediaStream | null = null;
let videoEncoder: VideoEncoder | null = null;
let audioEncoder: AudioEncoder | null = null;
let muxerOutput: Output<Mp4OutputFormat, BufferTarget> | null = null;
let videoSource: EncodedVideoPacketSource | null = null;
let audioSource: EncodedAudioPacketSource | null = null;
let bufferTarget: BufferTarget | null = null;
let startedAt = 0;
let stopping = false;

// Ordered async queues for encoder→muxer bridge (callbacks are sync, add() is async)
let videoAddChain = Promise.resolve();
let audioAddChain = Promise.resolve();

// Resolve when frame/audio read loops complete
let videoReadDone: Promise<void> = Promise.resolve();
let audioReadDone: Promise<void> = Promise.resolve();

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
    videoAddChain = Promise.resolve();
    audioAddChain = Promise.resolve();

    const videoTrack = stream.getVideoTracks()[0]!;
    const audioTrack = stream.getAudioTracks()[0]!;
    const vs = videoTrack.getSettings();
    const as_ = audioTrack.getSettings();

    const width = vs.width ?? 1920;
    const height = vs.height ?? 1080;
    const sampleRate = as_.sampleRate ?? 48000;
    const channelCount = as_.channelCount ?? 2;

    // --- Check WebCodecs support ---
    const videoConfig: VideoEncoderConfig = {
      codec: "avc1.42001f", // Baseline Profile, Level 3.1
      width,
      height,
      bitrate: config.videoBitsPerSecond,
      framerate: config.fps,
    };
    const { supported: videoOk } = await VideoEncoder.isConfigSupported(videoConfig);
    if (!videoOk) throw new Error("H.264 encoding not supported on this device");

    const audioConfig: AudioEncoderConfig = {
      codec: "mp4a.40.2", // AAC-LC
      numberOfChannels: channelCount,
      sampleRate,
      bitrate: 128_000,
    };
    const { supported: audioOk } = await AudioEncoder.isConfigSupported(audioConfig);
    if (!audioOk) throw new Error("AAC encoding not supported on this device");

    // --- Mediabunny muxer ---
    bufferTarget = new BufferTarget();
    muxerOutput = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: bufferTarget,
    });

    videoSource = new EncodedVideoPacketSource("avc");
    muxerOutput.addVideoTrack(videoSource, { frameRate: config.fps });

    audioSource = new EncodedAudioPacketSource("aac");
    muxerOutput.addAudioTrack(audioSource);

    await muxerOutput.start();

    // --- WebCodecs encoders ---
    videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        videoAddChain = videoAddChain.then(() =>
          videoSource!.add(
            EncodedPacket.fromEncodedChunk(chunk),
            metadata ?? undefined,
          ),
        );
      },
      error: (e) => console.error("[offscreen] VideoEncoder error:", e),
    });
    videoEncoder.configure(videoConfig);

    audioEncoder = new AudioEncoder({
      output: (chunk, metadata) => {
        audioAddChain = audioAddChain.then(() =>
          audioSource!.add(
            EncodedPacket.fromEncodedChunk(chunk),
            metadata ?? undefined,
          ),
        );
      },
      error: (e) => console.error("[offscreen] AudioEncoder error:", e),
    });
    audioEncoder.configure(audioConfig);

    // --- Frame/audio processing loops ---
    let frameCount = 0;

    videoReadDone = (async () => {
      const reader = new MediaStreamTrackProcessor({ track: videoTrack })
        .readable.getReader();
      try {
        while (true) {
          const { value: frame, done } = await reader.read();
          if (done || !frame || stopping) {
            frame?.close();
            break;
          }
          if (videoEncoder!.encodeQueueSize <= 5) {
            const keyFrame = frameCount % 150 === 0;
            videoEncoder!.encode(frame, { keyFrame });
            frameCount++;
          }
          frame.close();
        }
      } catch (e) {
        if (!stopping) console.error("[offscreen] Video read error:", e);
      }
    })();

    audioReadDone = (async () => {
      const reader = new MediaStreamTrackProcessor({ track: audioTrack })
        .readable.getReader();
      try {
        while (true) {
          const { value: data, done } = await reader.read();
          if (done || !data || stopping) {
            data?.close();
            break;
          }
          if (audioEncoder!.encodeQueueSize <= 5) {
            audioEncoder!.encode(data);
          }
          data.close();
        }
      } catch (e) {
        if (!stopping) console.error("[offscreen] Audio read error:", e);
      }
    })();

    startedAt = Date.now();

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_STARTED,
      startedAt,
    } satisfies ExtensionMessage).catch(console.error);

    console.log(
      `[offscreen] Recording started: H.264/AAC, ${width}x${height}, ${config.videoBitsPerSecond / 1_000_000} Mbps`,
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
  if (stopping || !mediaStream) return;
  stopping = true;

  const durationMs = Date.now() - startedAt;

  try {
    // Stop media tracks — readable streams will end
    mediaStream.getTracks().forEach((t) => t.stop());

    // Wait for read loops to drain
    await Promise.all([videoReadDone, audioReadDone]);

    // Flush remaining frames through encoders
    await videoEncoder?.flush();
    await audioEncoder?.flush();

    // Wait for all pending muxer writes
    await Promise.all([videoAddChain, audioAddChain]);

    // Close sources and finalize MP4
    videoSource?.close();
    audioSource?.close();
    await muxerOutput?.finalize();

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
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  videoEncoder = null;
  audioEncoder = null;
  muxerOutput = null;
  videoSource = null;
  audioSource = null;
  bufferTarget = null;
  startedAt = 0;
  stopping = false;
  videoAddChain = Promise.resolve();
  audioAddChain = Promise.resolve();
  videoReadDone = Promise.resolve();
  audioReadDone = Promise.resolve();
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

console.log("[offscreen] Document loaded (WebCodecs + mediabunny muxer)");
