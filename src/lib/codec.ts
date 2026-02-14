// Codec negotiation with ordered fallback chain.
// Prefers MP4 (H.264/AAC) for universal compatibility and correct duration.
// Falls back to WebM (VP9/VP8) on older Chrome versions.

export interface CodecResult {
  readonly mimeType: string;
  readonly label: string;
  readonly hasAudioCodec: boolean;
}

const CODEC_CANDIDATES: readonly { mimeType: string; label: string; hasAudioCodec: boolean }[] = [
  // MP4 — native duration/seeking, plays everywhere (Chrome 130+)
  { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", label: "H.264 + AAC", hasAudioCodec: true },
  { mimeType: "video/mp4", label: "MP4 (default)", hasAudioCodec: false },
  // WebM — fallback for older Chrome
  { mimeType: "video/webm;codecs=vp9,opus", label: "VP9 + Opus", hasAudioCodec: true },
  { mimeType: "video/webm;codecs=vp9", label: "VP9", hasAudioCodec: false },
  { mimeType: "video/webm;codecs=vp8,opus", label: "VP8 + Opus", hasAudioCodec: true },
  { mimeType: "video/webm;codecs=vp8", label: "VP8", hasAudioCodec: false },
  { mimeType: "video/webm", label: "WebM (default)", hasAudioCodec: false },
];

export function negotiateCodec(): CodecResult {
  for (const candidate of CODEC_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      console.log(`[codec] Selected: ${candidate.label} (${candidate.mimeType})`);
      return candidate;
    }
  }
  throw new Error("No supported video codec found for MediaRecorder");
}
