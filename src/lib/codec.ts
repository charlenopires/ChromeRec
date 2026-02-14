// VP9 codec negotiation with ordered fallback chain.
// Uses MediaRecorder.isTypeSupported() to find the best available codec.

export interface CodecResult {
  readonly mimeType: string;
  readonly label: string;
  readonly hasAudioCodec: boolean;
}

const CODEC_CANDIDATES: readonly { mimeType: string; label: string; hasAudioCodec: boolean }[] = [
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
