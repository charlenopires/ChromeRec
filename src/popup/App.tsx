import { useState, useEffect, useCallback, useRef } from "react";
import {
  MessageType,
  isExtensionMessage,
  type ExtensionMessage,
  type AckResponse,
  type StatusResponse,
} from "@/types/messages";
import {
  saveRecording,
  getRecording,
  listRecordings,
  deleteRecording,
  getStorageEstimate,
  type RecordingMeta,
} from "@/lib/db";
import { generateFilename } from "@/lib/filename";
import { formatDuration, formatSize, formatDate } from "@/lib/format";
import fixWebmDuration from "webm-duration-fix";

// --- State machine ---

type RecordingPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "completed"
  | "error";

interface AppState {
  phase: RecordingPhase;
  startedAt: number | null;
  errorMessage: string | null;
  lastSavedId: number | null;
  durationMs: number | null;
}

const INITIAL_STATE: AppState = {
  phase: "idle",
  startedAt: null,
  errorMessage: null,
  lastSavedId: null,
  durationMs: null,
};

// --- Timer hook ---

function useTimer(startedAt: number | null, active: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || startedAt === null) {
      setElapsed(0);
      return;
    }

    setElapsed(Date.now() - startedAt);
    intervalRef.current = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, startedAt]);

  return formatDuration(elapsed);
}

// --- Styles ---

const styles = {
  container: {
    width: 380,
    height: 500,
    background: "#1a1a2e",
    color: "#e0e0e0",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "flex",
    flexDirection: "column" as const,
    padding: 0,
    overflow: "hidden",
  },
  header: {
    width: "100%",
    padding: "12px 20px",
    borderBottom: "1px solid #2a2a4a",
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxSizing: "border-box" as const,
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    margin: 0,
    color: "#ffffff",
    flex: 1,
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    padding: 20,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    border: "3px solid #e53935",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
  },
  recordIcon: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "#e53935",
  },
  stopButton: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    border: "3px solid #e53935",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
  },
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: 4,
    background: "#e53935",
  },
  disabledButton: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    border: "3px solid #555",
    background: "transparent",
    cursor: "not-allowed",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.6,
  },
  spinnerText: {
    color: "#888",
    fontSize: 12,
    fontWeight: 500,
  },
  recIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  recDot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#e53935",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  recLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "#e53935",
    letterSpacing: 2,
  },
  timer: {
    fontSize: 40,
    fontWeight: 300,
    color: "#ffffff",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: 2,
  },
  errorBanner: {
    width: "100%",
    padding: "10px 16px",
    background: "#3d1515",
    borderBottom: "1px solid #e53935",
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxSizing: "border-box" as const,
    flexShrink: 0,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: "#ff8a80",
  },
  errorDismiss: {
    background: "transparent",
    border: "none",
    color: "#ff8a80",
    cursor: "pointer",
    fontSize: 16,
    padding: 4,
    lineHeight: 1,
  },
  retryButton: {
    background: "transparent",
    border: "1px solid #ff8a80",
    borderRadius: 4,
    color: "#ff8a80",
    cursor: "pointer",
    fontSize: 12,
    padding: "4px 10px",
    whiteSpace: "nowrap" as const,
  },
  downloadPanel: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 12,
  },
  downloadButton: {
    background: "#4caf50",
    border: "none",
    borderRadius: 8,
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
    padding: "12px 32px",
  },
  completedDuration: {
    fontSize: 14,
    color: "#888",
  },
  newRecordingButton: {
    background: "transparent",
    border: "1px solid #555",
    borderRadius: 6,
    color: "#aaa",
    cursor: "pointer",
    fontSize: 13,
    padding: "8px 20px",
  },
  // --- Recordings list ---
  recordingsList: {
    width: "100%",
    flex: 1,
    overflowY: "auto" as const,
    borderTop: "1px solid #2a2a4a",
  },
  listHeader: {
    padding: "10px 16px 6px",
    fontSize: 12,
    color: "#888",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  listItem: {
    padding: "10px 16px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    borderBottom: "1px solid #1e1e3a",
  },
  listItemInfo: {
    flex: 1,
    minWidth: 0,
  },
  listItemTitle: {
    fontSize: 13,
    color: "#e0e0e0",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  listItemMeta: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
  },
  listAction: {
    background: "transparent",
    border: "1px solid #444",
    borderRadius: 4,
    color: "#aaa",
    cursor: "pointer",
    fontSize: 11,
    padding: "4px 8px",
    whiteSpace: "nowrap" as const,
  },
  listActionDanger: {
    background: "transparent",
    border: "1px solid #e53935",
    borderRadius: 4,
    color: "#e53935",
    cursor: "pointer",
    fontSize: 11,
    padding: "4px 8px",
    whiteSpace: "nowrap" as const,
  },
  // --- Delete confirmation dialog ---
  dialogOverlay: {
    position: "absolute" as const,
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  dialog: {
    background: "#252547",
    borderRadius: 12,
    padding: 24,
    width: 280,
    textAlign: "center" as const,
  },
  dialogText: {
    fontSize: 14,
    color: "#e0e0e0",
    marginBottom: 20,
  },
  dialogActions: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
  },
  dialogDelete: {
    background: "#e53935",
    border: "none",
    borderRadius: 6,
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 20px",
  },
  dialogKeep: {
    background: "transparent",
    border: "1px solid #555",
    borderRadius: 6,
    color: "#aaa",
    cursor: "pointer",
    fontSize: 13,
    padding: "8px 20px",
  },
  // --- Storage quota ---
  quotaBar: {
    width: "100%",
    padding: "6px 16px",
    borderTop: "1px solid #2a2a4a",
    fontSize: 11,
    color: "#666",
    boxSizing: "border-box" as const,
    flexShrink: 0,
  },
  emptyList: {
    padding: "20px 16px",
    textAlign: "center" as const,
    fontSize: 13,
    color: "#555",
  },
} as const;

// --- Pulse animation ---

const PULSE_KEYFRAMES = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`;

// --- Component ---

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);
  const timerDisplay = useTimer(state.startedAt, state.phase === "recording");

  // Load recordings and storage info on mount
  const refreshData = useCallback(async () => {
    const [recs, estimate] = await Promise.all([
      listRecordings(),
      getStorageEstimate(),
    ]);
    setRecordings(recs);
    setStorageInfo(estimate);
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Recover state from service worker on mount
  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: MessageType.GET_STATUS } satisfies ExtensionMessage,
      (response: StatusResponse) => {
        if (response?.isRecording && response.startedAt) {
          setState((prev) => ({
            ...prev,
            phase: "recording",
            startedAt: response.startedAt,
          }));
        }
      },
    );
  }, []);

  // Listen for messages from service worker
  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isExtensionMessage(message)) return;

      switch (message.type) {
        case MessageType.RECORDING_STARTED:
          setState((prev) => ({
            ...prev,
            phase: "recording",
            startedAt: message.startedAt,
            errorMessage: null,
          }));
          break;

        case MessageType.RECORDING_STOPPED: {
          const { chunks, mimeType, durationMs } = message;
          const rawBlob = new Blob(chunks, { type: mimeType });

          // Fix WebM duration + add Cues for seeking (MediaRecorder omits both)
          fixWebmDuration(rawBlob).then((fixedBlob) => {
            // Get tab title for filename
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const tabTitle = tabs[0]?.title ?? "untitled";
              const filename = generateFilename(tabTitle);

              saveRecording({
                filename,
                mimeType,
                size: fixedBlob.size,
                durationMs,
                createdAt: Date.now(),
                tabTitle,
                blob: fixedBlob,
              }).then((id) => {
                setState((prev) => ({
                  ...prev,
                  phase: "completed",
                  lastSavedId: id,
                  durationMs,
                }));
                refreshData();
              });
            });
          });
          break;
        }

        case MessageType.RECORDING_ERROR:
          setState((prev) => ({
            ...prev,
            phase: "error",
            errorMessage: message.message,
          }));
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshData]);

  const handleRecord = useCallback(() => {
    setState((prev) => ({ ...prev, phase: "requesting", errorMessage: null }));
    chrome.runtime.sendMessage(
      { type: MessageType.START_RECORDING } satisfies ExtensionMessage,
      (response: AckResponse) => {
        if (response && !response.ok) {
          setState((prev) => ({
            ...prev,
            phase: "error",
            errorMessage: response.error ?? "Failed to start recording",
          }));
        }
      },
    );
  }, []);

  const handleStop = useCallback(() => {
    setState((prev) => ({ ...prev, phase: "stopping" }));
    chrome.runtime.sendMessage(
      { type: MessageType.STOP_RECORDING } satisfies ExtensionMessage,
      (response: AckResponse) => {
        if (response && !response.ok) {
          setState((prev) => ({
            ...prev,
            phase: "error",
            errorMessage: response.error ?? "Failed to stop recording",
          }));
        }
      },
    );
  }, []);

  const handleDownload = useCallback(async (id: number) => {
    const rec = await getRecording(id);
    if (!rec) return;

    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = rec.filename;
    a.click();
    URL.revokeObjectURL(url);

    // Show delete confirmation after download
    setDeleteConfirmId(id);
  }, []);

  const handleDownloadLatest = useCallback(() => {
    if (state.lastSavedId !== null) {
      handleDownload(state.lastSavedId);
    }
  }, [state.lastSavedId, handleDownload]);

  const handleConfirmDelete = useCallback(async () => {
    if (deleteConfirmId === null) return;
    await deleteRecording(deleteConfirmId);
    setDeleteConfirmId(null);
    await refreshData();

    // If we just deleted the last saved recording, go back to idle
    if (state.lastSavedId === deleteConfirmId) {
      setState(INITIAL_STATE);
    }
  }, [deleteConfirmId, refreshData, state.lastSavedId]);

  const handleKeep = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  const handleDirectDelete = useCallback((id: number) => {
    setDeleteConfirmId(id);
  }, []);

  const handleDismissError = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const handleNewRecording = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const isActivePhase = state.phase !== "idle" && state.phase !== "error";

  return (
    <div style={{ ...styles.container, position: "relative" as const }}>
      <style>{PULSE_KEYFRAMES}</style>

      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>ChromeRec</h1>
        {storageInfo && recordings.length > 0 && (
          <span style={{ fontSize: 11, color: "#666" }}>
            {formatSize(storageInfo.usage)}
          </span>
        )}
      </div>

      {/* Error banner */}
      {state.phase === "error" && state.errorMessage && (
        <div style={styles.errorBanner} role="alert">
          <span style={styles.errorText}>{state.errorMessage}</span>
          <button
            style={styles.retryButton}
            onClick={handleRecord}
            aria-label="Retry recording"
          >
            Retry
          </button>
          <button
            style={styles.errorDismiss}
            onClick={handleDismissError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main content */}
      <div style={styles.content}>
        {/* Idle state */}
        {state.phase === "idle" && (
          <>
            <button
              style={styles.recordButton}
              onClick={handleRecord}
              aria-label="Start recording"
            >
              <div style={styles.recordIcon} />
            </button>
            <span style={{ color: "#888", fontSize: 13 }}>
              Click to record this tab
            </span>
          </>
        )}

        {/* Requesting state */}
        {state.phase === "requesting" && (
          <>
            <div style={styles.disabledButton} aria-busy="true">
              <span style={styles.spinnerText}>...</span>
            </div>
            <span style={{ color: "#888", fontSize: 13 }}>
              Starting capture...
            </span>
          </>
        )}

        {/* Recording state */}
        {state.phase === "recording" && (
          <>
            <div style={styles.recIndicator}>
              <div style={styles.recDot} />
              <span style={styles.recLabel}>REC</span>
            </div>
            <span style={styles.timer}>{timerDisplay}</span>
            <button
              style={styles.stopButton}
              onClick={handleStop}
              aria-label="Stop recording"
            >
              <div style={styles.stopIcon} />
            </button>
          </>
        )}

        {/* Stopping state */}
        {state.phase === "stopping" && (
          <>
            <div style={styles.disabledButton} aria-busy="true">
              <span style={styles.spinnerText}>...</span>
            </div>
            <span style={{ color: "#888", fontSize: 13 }}>
              Stopping...
            </span>
          </>
        )}

        {/* Completed state */}
        {state.phase === "completed" && (
          <div style={styles.downloadPanel}>
            <span style={{ fontSize: 40 }}>&#10003;</span>
            <span style={styles.completedDuration}>
              {state.durationMs !== null
                ? `Recorded ${formatDuration(state.durationMs)}`
                : "Recording complete"}
            </span>
            <button
              style={styles.downloadButton}
              onClick={handleDownloadLatest}
              aria-label="Download recording"
            >
              Download
            </button>
            <button
              style={styles.newRecordingButton}
              onClick={handleNewRecording}
              aria-label="Start new recording"
            >
              New Recording
            </button>
          </div>
        )}

        {/* Error state (content area — banner is above) */}
        {state.phase === "error" && (
          <button
            style={styles.recordButton}
            onClick={handleRecord}
            aria-label="Start recording"
          >
            <div style={styles.recordIcon} />
          </button>
        )}
      </div>

      {/* Recordings list */}
      {!isActivePhase && recordings.length > 0 && (
        <div style={styles.recordingsList}>
          <div style={styles.listHeader}>
            Past Recordings ({recordings.length})
          </div>
          {recordings.map((rec) => (
            <div key={rec.id} style={styles.listItem}>
              <div style={styles.listItemInfo}>
                <div style={styles.listItemTitle}>{rec.tabTitle}</div>
                <div style={styles.listItemMeta}>
                  {formatDuration(rec.durationMs)} &middot; {formatSize(rec.size)} &middot; {formatDate(rec.createdAt)}
                </div>
              </div>
              <button
                style={styles.listAction}
                onClick={() => handleDownload(rec.id)}
                aria-label={`Download ${rec.tabTitle}`}
              >
                Save
              </button>
              <button
                style={styles.listActionDanger}
                onClick={() => handleDirectDelete(rec.id)}
                aria-label={`Delete ${rec.tabTitle}`}
              >
                Del
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Storage quota footer */}
      {storageInfo && storageInfo.quota > 0 && recordings.length > 0 && (
        <div style={{
          ...styles.quotaBar,
          color: storageInfo.usage / storageInfo.quota > 0.8 ? "#ff8a80" : "#666",
        }}>
          Using {formatSize(storageInfo.usage)} of {formatSize(storageInfo.quota)}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmId !== null && (
        <div style={styles.dialogOverlay}>
          <div style={styles.dialog}>
            <div style={styles.dialogText}>
              Delete local copy?
            </div>
            <div style={styles.dialogActions}>
              <button
                style={styles.dialogKeep}
                onClick={handleKeep}
                aria-label="Keep recording"
              >
                Keep
              </button>
              <button
                style={styles.dialogDelete}
                onClick={handleConfirmDelete}
                aria-label="Delete recording"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
