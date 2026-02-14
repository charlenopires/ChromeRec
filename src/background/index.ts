// Service worker: orchestrates tab capture, offscreen document lifecycle, and message routing.
// State persisted via chrome.storage.session so popup can recover state on reopen.

import {
  MessageType,
  DEFAULT_RECORDING_CONFIG,
  isExtensionMessage,
  type RecordingConfig,
  type ExtensionMessage,
  type StatusResponse,
  type AckResponse,
} from "@/types/messages";

// --- State (persisted in chrome.storage.session) ---

const STORAGE_KEY = "recordingState";

interface RecordingState {
  isRecording: boolean;
  startedAt: number | null;
  tabId: number | null;
  config: RecordingConfig;
}

const DEFAULT_STATE: RecordingState = {
  isRecording: false,
  startedAt: null,
  tabId: null,
  config: DEFAULT_RECORDING_CONFIG,
};

async function getState(): Promise<RecordingState> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as RecordingState | undefined) ?? DEFAULT_STATE;
}

async function saveState(state: RecordingState): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: state });
}

async function resetState(): Promise<void> {
  await saveState(DEFAULT_STATE);
}

// --- Offscreen document lifecycle ---

const OFFSCREEN_URL = "src/offscreen/index.html";

async function ensureOffscreenDocument(): Promise<void> {
  const exists = await chrome.offscreen.hasDocument();
  if (exists) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [
      chrome.offscreen.Reason.USER_MEDIA,
      chrome.offscreen.Reason.BLOBS,
    ],
    justification: "Video encoding for tab capture",
  });
}

async function closeOffscreenDocument(): Promise<void> {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) return;
  await chrome.offscreen.closeDocument();
}

// --- Tab capture ---

function getMediaStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(streamId);
      }
    });
  });
}

// --- Badge ---
// 5 states: idle (clear), requesting/stopping (orange "..."), recording (red "REC"),
// completed (green checkmark), error (red "!")

function setBadgeRequesting(): void {
  chrome.action.setBadgeText({ text: "..." });
  chrome.action.setBadgeBackgroundColor({ color: "#ff9800" });
}

function setBadgeRecording(): void {
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
}

function setBadgeCompleted(): void {
  chrome.action.setBadgeText({ text: "\u2713" });
  chrome.action.setBadgeBackgroundColor({ color: "#4caf50" });
}

function setBadgeError(): void {
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
}

// --- Recording orchestration ---

async function startRecording(config: RecordingConfig): Promise<AckResponse> {
  const state = await getState();
  if (state.isRecording) {
    return { ok: false, error: "Already recording" };
  }

  setBadgeRequesting();

  try {
    // 1. Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { ok: false, error: "No active tab found" };
    }

    // 2. Get media stream ID for tab capture
    const streamId = await getMediaStreamId(tab.id);

    // 3. Create offscreen document
    await ensureOffscreenDocument();

    // 4. Send stream ID to offscreen document
    await chrome.runtime.sendMessage({
      type: MessageType.STREAM_ID_READY,
      streamId,
      config,
      tabTitle: tab.title ?? "untitled",
    } satisfies ExtensionMessage);

    // 5. Persist state
    await saveState({
      isRecording: true,
      startedAt: Date.now(),
      tabId: tab.id,
      config,
    });

    setBadgeRecording();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sw] startRecording failed:", message);
    setBadgeError();

    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_ERROR,
      code: "TAB_CAPTURE_FAILED",
      message,
    } satisfies ExtensionMessage).catch(() => {
      // Popup may not be open to receive this
    });

    return { ok: false, error: message };
  }
}

async function stopRecording(): Promise<AckResponse> {
  const state = await getState();
  if (!state.isRecording) {
    return { ok: false, error: "Not recording" };
  }

  setBadgeRequesting();

  try {
    await chrome.runtime.sendMessage({
      type: MessageType.STOP_RECORDING,
    } satisfies ExtensionMessage);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sw] stopRecording failed:", message);
    setBadgeError();
    return { ok: false, error: message };
  }
}

// --- Message handler ---

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: StatusResponse | AckResponse) => void,
  ): boolean => {
    if (!isExtensionMessage(message)) return false;

    const msg: ExtensionMessage = message;

    switch (msg.type) {
      case MessageType.START_RECORDING: {
        const config: RecordingConfig = {
          ...DEFAULT_RECORDING_CONFIG,
          ...msg.config,
        };
        startRecording(config).then(sendResponse);
        return true;
      }

      case MessageType.STOP_RECORDING: {
        stopRecording().then(sendResponse);
        return true;
      }

      case MessageType.GET_STATUS: {
        getState().then((state) => {
          sendResponse({
            isRecording: state.isRecording,
            startedAt: state.startedAt,
            tabId: state.tabId,
          });
        });
        return true; // Async — keep channel open
      }

      case MessageType.RECORDING_STARTED: {
        console.log("[sw] Recording confirmed by offscreen at", msg.startedAt);
        return false;
      }

      case MessageType.RECORDING_STOPPED: {
        console.log(
          "[sw] Recording stopped: id=",
          msg.recordingId,
          msg.durationMs,
          "ms",
        );
        setBadgeCompleted();
        resetState().then(() => closeOffscreenDocument()).catch(console.error);
        return false;
      }

      case MessageType.RECORDING_ERROR: {
        console.error("[sw] Recording error:", msg.code, msg.message);
        setBadgeError();
        resetState().then(() => closeOffscreenDocument()).catch(console.error);
        return false;
      }

      case MessageType.STREAM_ID_READY: {
        // Only handled by offscreen document, not the service worker
        return false;
      }
    }
  },
);

// --- Tab close detection ---
// If the recorded tab is closed, stop recording gracefully.

chrome.tabs.onRemoved.addListener((tabId: number) => {
  getState().then((state) => {
    if (!state.isRecording || state.tabId !== tabId) return;

    console.log("[sw] Recorded tab closed, stopping recording");
    stopRecording().catch(console.error);
  }).catch(console.error);
});

// --- Stale state recovery ---
// Detects if the service worker restarted while a recording was in progress.
// If isRecording is true but the offscreen document is gone, the recording was lost.

async function recoverStaleState(): Promise<void> {
  const state = await getState();
  if (!state.isRecording) return;

  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) return; // Offscreen still alive — recording may still be running

  console.warn(
    "[sw] Stale recording state detected — recording was interrupted",
    state.startedAt ? `(started at ${new Date(state.startedAt).toISOString()})` : "",
  );

  await resetState();
  setBadgeError();
}

// Run on every service worker startup (covers idle timeout restarts)
recoverStaleState().catch(console.error);

// Browser restart: session storage is cleared by Chrome, but ensure clean badge
chrome.runtime.onStartup.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("ChromeRec installed");
});
