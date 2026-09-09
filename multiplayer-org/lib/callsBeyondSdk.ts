/**
 * The one file in this app that is not the SDK.
 *
 * WHY IT EXISTS.
 *
 * A call's most valuable content — what was actually said — is not reachable
 * through `@xyne/spaces-sdk`. The SDK's operation allowlist (the backend's
 * `api/sdk/v1/mapper.ts`) has 468 entries and not one of them returns a
 * transcript, a citation segment, or a duration. The `Call` row does carry a
 * `transcript` field, but it holds a STORAGE PATH —
 * `attachments/<externalId>_formatted.txt` — and the SDK exposes nothing that
 * reads a storage path. So an SDK-only app can know that a transcript exists
 * and can never show it.
 *
 * The dashboard reads it from `GET /api/calls/recordings/:externalId`, a plain
 * Express route that was never a Zero catalog operation and therefore never
 * appeared as a gap in the SDK's own coverage check. That one route returns the
 * transcript, the summary, the citation segments, the marked moments, the
 * duration and the linked ticket — everything the detail view of a recording
 * needs, in a single request.
 *
 * WHY IT IS ITS OWN FILE.
 *
 * "Built on the SDK alone" is a claim about this app, and a claim is only worth
 * something if it can be checked. Keeping every non-SDK call in one file makes
 * the boundary auditable: delete this file and `lib/calls.ts` still compiles and
 * the app still runs, with the transcript panel replaced by an explanation.
 * Nothing else imports from here except the transcript surface, and the UI marks
 * what came from here so nobody mistakes it for SDK-backed data.
 *
 * WHAT SHOULD REPLACE IT.
 *
 * One operation: `calls.getTranscript({ callId })`, or better, a
 * `calls.getRecordingDetail({ externalId })` that returns the shape below. The
 * data, the permission checks and the route already exist — only the registry
 * entry is missing. See SCRIBE-SDK-GAPS.md §1.
 */
import { token } from './xyne';

/**
 * One line of transcript, as the citation index sees it.
 *
 * `n` is what a `[clf-N]` token in a summary points at, which is why summaries
 * cite segment numbers rather than times: the number is stable while the
 * rendering of the time is not.
 */
export interface CitationSegment {
  n: number;
  /** `MM:SS`, an offset from the start of the call. */
  timestamp: string;
  speaker: string;
  /** The workspace user id, when the speaker was identified. */
  speakerId?: string;
  snippet?: string;
}

/** What the detail route returns. Everything optional — this is a payload,
 *  not a contract the SDK will hold us to. */
export interface RecordingDetail {
  id: string;
  externalId: string;
  title?: string | null;
  /** `[MM:SS] Speaker: text` lines, newline separated. */
  transcript?: string | null;
  /** The same, with speakers resolved to workspace identities. Usually null. */
  identifiedTranscript?: string | null;
  hasTranscript?: boolean;
  aiSummary?: string | null;
  hasSummary?: boolean;
  citationSegments?: CitationSegment[];
  markedItems?: unknown[];
  labels?: string[];
  durationMs?: number | null;
  /** Whether media exists. It is a byte stream, never a URL — see `MEDIA_NOTE`. */
  hasRecording?: boolean;
  /** The dashboard's own call↔ticket link. We cannot write it (no op), but
   *  reading it tells us the call is already attached to something. */
  linkedTicketId?: string | null;
  notesCanvasId?: string | null;
  detailedSummaryCanvasId?: string | null;
  summaryTemplateId?: string | null;
  visibility?: string;
}

/** One parsed transcript line. */
export interface TranscriptLine {
  /** Offset into the call, in seconds. */
  seconds: number;
  /** `MM:SS`, as written. */
  stamp: string;
  speaker: string;
  text: string;
}

/**
 * Why there is no play button.
 *
 * The media exists — the detail route reports `hasRecording` and the dashboard
 * streams it from `/api/calls/:externalId/download-recording`. Two things stop
 * it being playable here, and both are structural rather than a matter of
 * effort:
 *
 *   1. It is served as an authenticated byte stream, never as a URL. An
 *      `<audio src>` cannot carry an Authorization header, so the element
 *      cannot fetch it, and fetching it ourselves means holding the whole file
 *      (68 MB for a one-hour call) in memory before the first second plays —
 *      the route ignores Range requests, so there is no seek-before-download.
 *   2. Published, this app's requests are tunnelled to the host over
 *      postMessage, and that bridge resolves every response body as a string
 *      (see lib/xyne.ts). Binary has no path home.
 *
 * So Scribe treats the TRANSCRIPT as the playback surface — it is seekable,
 * searchable, quotable and survives being pasted into a ticket, which audio
 * does not — and links out to Spaces for the audio itself.
 */
export const MEDIA_NOTE =
  'Audio is served as an authenticated byte stream with no seekable URL, so it plays in Spaces rather than here.';

/** Live-dev only. Published, the host's cookie carries auth instead. */
function authHeaders(): Record<string, string> {
  return { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const cache = new Map<string, RecordingDetail | null>();

/**
 * Everything about one recording, in one request.
 *
 * Keyed by `externalId` — the realtime room's id, not the call row's `id`.
 * Passing the row id returns 404, which is the same trap `calls.getRecording`
 * has and the reason both are wrapped rather than called inline.
 *
 * Returns null rather than throwing when the route is unavailable: this is the
 * enrichment layer, and a call that cannot be enriched should render as a call
 * without a transcript, not as an error. The caller can tell the two apart —
 * null means "nothing to show here", and the surface says so.
 */
export async function recordingDetail(externalId: string): Promise<RecordingDetail | null> {
  if (!externalId) return null;
  const hit = cache.get(externalId);
  if (hit !== undefined) return hit;
  try {
    const detail = (await fromRecordingRoute(externalId)) ?? (await fromTranscriptRoute(externalId));
    // Cached including a null — "this call has no transcript" is a real answer
    // and re-asking it on every click is two wasted requests.
    cache.set(externalId, detail);
    return detail;
  } catch {
    // A transport failure is NOT an answer. Caching it would mark the call as
    // having no transcript for the rest of the session over one dropped
    // request, and nothing in the UI would ever retry.
    return null;
  }
}

/**
 * The rich route: summary, citation index, marks, duration, all at once.
 *
 * Only answers for RECORDINGS — the headless capture kind, which is what the
 * dashboard's Recordings screen lists. A call that started in a conversation
 * has a transcript but no recording row, and this 404s for it. That is not an
 * error worth surfacing; it is the reason `fromTranscriptRoute` exists.
 */
async function fromRecordingRoute(externalId: string): Promise<RecordingDetail | null> {
  const res = await fetch(`/api/calls/recordings/${encodeURIComponent(externalId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null; // 404 for a conversation call — an answer, not a failure
  const body = (await res.json()) as { recording?: RecordingDetail };
  return body?.recording ?? null;
}

/**
 * The thin route: the transcript text and nothing else.
 *
 * For conversation calls, which are most of them. There is no citation index
 * and no duration here, so a summary's `[clf-N]` tokens stay unresolved on
 * these — the transcript is still readable, seekable and quotable, which is
 * what people came for.
 */
async function fromTranscriptRoute(externalId: string): Promise<RecordingDetail | null> {
  const res = await fetch(`/api/calls/${encodeURIComponent(externalId)}/download-transcript`, {
    headers: { ...authHeaders(), Accept: 'text/plain' },
  });
  if (!res.ok) return null;
  const text = await res.text();
  // A JSON error body with a 200 would otherwise render as one long transcript
  // line; a real transcript starts with a timestamp.
  if (!text.trim() || !/^\[\d{1,2}:\d{2}/.test(text.trim())) return null;
  return { id: externalId, externalId, transcript: text, hasTranscript: true };
}

const LINE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]{1,60}?):\s*(.*)$/;

/**
 * Split a transcript into lines.
 *
 * The format is `[MM:SS] Speaker: text`, one utterance per line, and a long
 * utterance is one very long line rather than several. Anything that does not
 * match is appended to the previous line rather than dropped — a transcript
 * with a stray line is still a transcript, and losing speech to a regex is
 * worse than an odd-looking paragraph.
 */
export function parseTranscript(raw: string | null | undefined): TranscriptLine[] {
  if (!raw) return [];
  const out: TranscriptLine[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = LINE.exec(trimmed);
    if (!m) {
      // Append to the line before it — unless there is no line before it, in
      // which case open one rather than dropping the words. A transcript whose
      // very first line is malformed is still a transcript.
      if (out.length) out[out.length - 1].text += ` ${trimmed}`;
      else out.push({ seconds: 0, stamp: '0:00', speaker: '', text: trimmed });
      continue;
    }
    const parts = m[1].split(':').map(Number);
    out.push({
      seconds: parts.reduce((acc, p) => acc * 60 + p, 0),
      stamp: m[1],
      speaker: m[2].trim(),
      text: m[3].trim(),
    });
  }
  return out;
}

/** The people heard on a call, in order of first speaking. */
export function speakersOf(lines: TranscriptLine[]): string[] {
  const seen: string[] = [];
  for (const l of lines) if (l.speaker && !seen.includes(l.speaker)) seen.push(l.speaker);
  return seen;
}

/**
 * The transcript line at or just before an offset.
 *
 * Used to resolve a `[clf-MM:SS]` citation and a marked moment to what was
 * being said, so both can quote their evidence instead of pointing at a time
 * nobody can look up.
 */
export function lineAt(lines: TranscriptLine[], seconds: number): TranscriptLine | null {
  let best: TranscriptLine | null = null;
  for (const l of lines) {
    if (l.seconds <= seconds) best = l;
    else break;
  }
  return best ?? lines[0] ?? null;
}

/** Resolve a `[clf-N]` segment number against the citation index. */
export function segmentAt(segments: CitationSegment[] | undefined, n: number): CitationSegment | null {
  if (!segments?.length) return null;
  return segments.find(s => s.n === n) ?? null;
}
