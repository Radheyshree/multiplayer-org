import { rawOp, token, xyne } from './xyne';
import { resolvePeople } from './people';

/* ---- from lib/calls.ts ------------------------------------------------ */
/**
 * Calls, recordings, and what was decided on them — the SDK half.
 *
 * Everything in this file goes through `@xyne/spaces-sdk`. The one thing the
 * SDK cannot reach (the transcript itself) lives in `callsBeyondSdk.ts`, alone,
 * so the boundary is a file boundary and not a comment.
 *
 * THREE THINGS TO KNOW BEFORE READING THE REST.
 *
 * 1. The declared `Call` type is a subset of the row the server sends. The SDK
 *    declares 20 fields; `calls.listHistory` returns 39. The missing ones are
 *    not incidental — `aiSummary`, `markedItems`, `transcript`, `labels`,
 *    `visibility` and `startedAt` are most of what a call is ABOUT. So `Call`
 *    below is the shape observed on the wire, and the SDK's is treated as an
 *    out-of-date view of it (see SCRIBE-SDK-GAPS.md §4).
 *
 * 2. `startsAt` is null on every call that actually happened. It is the
 *    SCHEDULED time, so it is set for calendar rows and null for everything
 *    ad-hoc; the real clock time of a past call is `startedAt`. Reading
 *    `startsAt` alone renders every past call as "—", which is what this app
 *    used to do. `whenOf` is the only thing that should read either.
 *
 * 3. `organizerId` is null on every row observed — 25/25 in history, 5/5 in
 *    recordings. `createdByUserId` is the field that is actually populated.
 *    `organiserOf` prefers the one that exists.
 *
 * The four listings and the search index answer different questions and the app
 * uses both: the listings are the user's OWN calls with their summaries
 * attached, and search is the only way to ask "on this track" without reading
 * the whole workspace first (see `searchCalls`).
 */

// ---------------------------------------------------------------------------
// The row, as it actually arrives
// ---------------------------------------------------------------------------

export type CallStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'MISSED';
export type CallKind = 'AUDIO' | 'VIDEO' | 'HEADLESS';

/**
 * A call row.
 *
 * Every field the server sends, with the ones the SDK omits marked. Optional
 * throughout because this is a description of a payload rather than a contract
 * the SDK will hold us to — a field that stops arriving should render as
 * missing, not throw.
 */
export interface Call {
  id: string;
  /** The realtime room's id. `getRecording` and the room link key off THIS,
   *  not `id` — passing the row id returns null. */
  externalId?: string;
  title?: string | null;
  status?: CallStatus;
  callType?: CallKind;
  /** CONVERSATION | CHANNEL | GOOGLE_CALENDAR — where the call came from.
   *  Not in the SDK's type. */
  callOrigin?: string | null;
  /**
   * The channel the call belongs to — and the reason the old "this track only"
   * toggle never worked on recordings. It is populated on calls that started in
   * a conversation, and NULL on 23 of the 24 recordings in this workspace,
   * because a headless recording is not attached to a channel at all. Filtering
   * a recordings list on it can only ever return nothing. `searchCalls` is the
   * scoping mechanism that actually holds.
   */
  channelId?: string | null;
  roomLink?: string | null;
  description?: string | null;

  /** Scheduled start. Null for anything not put on a calendar. */
  startsAt?: number | null;
  endsAt?: number | null;
  /** When it really began. This is the one to show for a past call. */
  startedAt?: number | null;
  endedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;

  /** Populated. Prefer over `organizerId`, which is not. */
  createdByUserId?: string | null;
  /** Declared by the SDK, null on every row observed. */
  organizerId?: string | null;

  participantCount?: number | null;
  /** JSON **string** of `[{ userId, hasJoined }]` — not an array. Lets a list
   *  row show faces without a per-row participants call. Not in the SDK's type. */
  participantPreviewUserIds?: string | null;
  /** JSON string, same trap. Used by headless recordings, which have no
   *  `call_participant` rows at all. Not in the SDK's type. */
  recordingParticipants?: string | null;
  /** Joined onto history rows by the server; empty on recordings. */
  participants?: CallParticipant[];

  /** The post-call summary, as markdown. The single richest field on the row,
   *  and absent from the SDK's `Call`. See `parseSummary`. */
  aiSummary?: string | null;
  /** Decisions, action items and user-flagged moments. Absent from the SDK's
   *  `Call`. See `parseMarked`. */
  markedItems?: unknown[] | null;
  /** Storage path of the transcript, e.g. `attachments/<externalId>_formatted.txt`.
   *  A PATH, not a URL, and the SDK exposes nothing that reads it — this field
   *  is how we know a transcript exists at all. */
  transcript?: string | null;
  summaryTemplateId?: string | null;

  recordingEnabled?: boolean;
  /** Null on every row observed, including ones with `recordingEnabled`. */
  recordingUrl?: string | null;

  /** Label ids. There is no SDK op that resolves them to names, which is why
   *  Scribe does not render them at all — see SCRIBE-SDK-GAPS.md §4a. */
  labels?: string[];
  visibility?: string;
  recurringSeriesId?: string | null;
  isRecurring?: boolean;
  metadata?: {
    notesCanvasId?: string;
    detailedSummaryCanvasId?: string;
    conversationId?: string;
    transcriptEntryCount?: number;
    [k: string]: unknown;
  } | null;
}

/**
 * Someone on a call.
 *
 * `displayName` and `email` are declared and always null — the row carries
 * `userId` and nothing else identifying. Resolving them is the caller's job,
 * which is what `participantsOf` does before it returns.
 */
export interface CallParticipant {
  id: string;
  callId?: string;
  userId?: string | null;
  /** JOINED | LEFT | … — the SDK calls this `status`, the wire calls it
   *  `response`. Both are read. */
  response?: string | null;
  status?: string | null;
  meetingStatus?: string | null;
  invitedBy?: string | null;
  invitedAt?: number | null;
  joinedAt?: number | null;
  leftAt?: number | null;
  isExternal?: boolean;
  displayName?: string | null;
  email?: string | null;
}

// ---------------------------------------------------------------------------
// Reading the row
// ---------------------------------------------------------------------------

/** A call that has not happened yet, and whose times mean something different. */
function isPlanned(ca: Call): boolean {
  return ca.status === 'SCHEDULED' || ca.status === 'CANCELLED';
}

/**
 * When the call is, or was.
 *
 * The two pairs of timestamps are NOT interchangeable and mixing them is how
 * this surface came to show "749h 30m" for a half-hour meeting.
 *   startsAt / endsAt   what was PLANNED. Set on calendar rows, null on ad-hoc.
 *   startedAt / endedAt what HAPPENED. On a scheduled row `startedAt` is the
 *                       moment the row was created — weeks before the meeting —
 *                       so reading it for an upcoming call gives a date in the
 *                       past.
 * So which one leads depends on whether the call has happened.
 */
export function whenOf(ca: Call): number | null {
  return isPlanned(ca)
    ? (ca.startsAt ?? ca.startedAt ?? ca.createdAt ?? null)
    : (ca.startedAt ?? ca.startsAt ?? ca.createdAt ?? null);
}

/** Who called it. `organizerId` is declared but never populated. */
export function organiserOf(ca: Call): string | null {
  return ca.createdByUserId ?? ca.organizerId ?? null;
}

/**
 * How long it ran, in ms.
 *
 * Only for calls that actually ran, and only from a matched pair. A planned
 * call has a planned length, which is a different claim — and for the all-day
 * calendar rows in this workspace it is 24 hours, which is not a useful thing
 * to print next to a meeting title. Null means "do not show a duration".
 */
export function durationOf(ca: Call): number | null {
  if (isPlanned(ca)) return null;
  const { startedAt: from, endedAt: to } = ca;
  return from && to && to > from ? to - from : null;
}

/**
 * The user ids on a call, from the list row alone.
 *
 * `participantPreviewUserIds` is a JSON string, not an array — `JSON.parse` on
 * a value the type says is already parsed is exactly the kind of thing that
 * only shows up at runtime, so it is done in one place. Headless recordings
 * carry `recordingParticipants` instead and neither field is guaranteed.
 */
export function previewIdsOf(ca: Call): string[] {
  const out: string[] = [];
  for (const raw of [ca.participantPreviewUserIds, ca.recordingParticipants]) {
    if (typeof raw !== 'string' || raw.length < 3) continue;
    try {
      const rows: unknown = JSON.parse(raw);
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const id = typeof r === 'string' ? r : (r as { userId?: string })?.userId;
        if (id && !out.includes(id)) out.push(id);
      }
    } catch {
      /* a malformed preview is a missing avatar row, never a broken list */
    }
  }
  if (!out.length && Array.isArray(ca.participants)) {
    for (const p of ca.participants) if (p.userId && !out.includes(p.userId)) out.push(p.userId);
  }
  return out;
}

/** Whether this call has something to read beyond its own title. */
export function hasSubstance(ca: Call): boolean {
  return Boolean(ca.aiSummary || (ca.markedItems && ca.markedItems.length) || ca.transcript);
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

/**
 * One `## Heading` block of a call summary.
 *
 * The summary is markdown generated from a template, and across the 21 rows in
 * this workspace that carry one the shape is identical: `## Summary:`,
 * `## Key outcomes:`, `## Action Items:`, `## Participants:`. It is still
 * parsed as "whatever headings are there" rather than as those four, because
 * `listSummaryTemplates` shows the workspace has other templates with entirely
 * different section sets ("💡 Key Takeaways", "⚖️ Trade-offs & Concerns"), and
 * any of them can produce a summary.
 */
export interface SummarySection {
  title: string;
  /** Lines with their list markers stripped; blank lines dropped. */
  lines: string[];
  /** True for `- ` / `1. ` blocks, which render as a list rather than prose. */
  isList: boolean;
}

const EMPTY_SECTION = /^(none|n\/?a|nothing|no .*)\.?$/i;

/** Split a call summary into its sections. Empty when there is no summary. */
export function parseSummary(md: string | null | undefined): SummarySection[] {
  if (!md) return [];
  const out: SummarySection[] = [];
  let current: SummarySection | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^#{1,4}\s+(.*?):?\s*$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), lines: [], isList: false };
      out.push(current);
      continue;
    }
    const body = line.trim();
    if (!body) continue;
    if (!current) {
      current = { title: '', lines: [], isList: false };
      out.push(current);
    }
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(body);
    if (item) {
      current.isList = true;
      current.lines.push(item[1]);
    } else {
      current.lines.push(body);
    }
  }
  // "None" under a heading is the template saying nothing happened there. It is
  // a real answer, but it should not render as a bullet that looks like content.
  return out.filter(s => s.lines.length > 0 && !(s.lines.length === 1 && EMPTY_SECTION.test(s.lines[0])));
}

/** Section titles that hold work someone agreed to do. Matched loosely because
 *  the wording is template-authored: "Action Items", "📋 Action Items", "Next steps". */
const ACTION_HEADING = /(action|next step|todo|to-do|follow[- ]?up)/i;

export function isActionSection(s: SummarySection): boolean {
  return ACTION_HEADING.test(s.title);
}

/**
 * A `[clf-…]` citation in a summary.
 *
 * Two forms occur, in the same workspace and sometimes the same summary:
 * `[clf-04:18]` is an offset into the recording, and `[clf-12]` is an index
 * into the transcript's segments. The first is readable on its own; the second
 * needs the transcript to mean anything, which is why `seconds` is nullable and
 * the UI shows a bare marker rather than a wrong time when it cannot resolve
 * one. Observed 135 timestamp / 63 numeric across 21 summaries.
 */
export interface Citation {
  /** The whole token, e.g. `[clf-04:18]`. */
  raw: string;
  /** Offset into the call in seconds, when the token carries one. */
  seconds: number | null;
  /** Segment index, when the token is numeric instead. */
  segment: number | null;
}

const CITATION = /\[clf-([0-9:]+)\]/g;

/** Read a citation token. Returns null for anything that is not one. */
export function readCitation(token: string): Citation | null {
  const m = /^\[clf-([0-9:]+)\]$/.exec(token);
  if (!m) return null;
  const value = m[1];
  if (!value.includes(':')) return { raw: token, seconds: null, segment: Number(value) };
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return { raw: token, seconds: null, segment: null };
  const seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
  return { raw: token, seconds, segment: null };
}

/**
 * Split a line into plain text and citation tokens, in order.
 *
 * Returned as a flat list rather than as `{ text, citations }` because the
 * citations belong where they were written — a chip after the clause it
 * supports reads as evidence, the same chips collected at the end of the line
 * read as a footnote nobody follows.
 */
export function splitCitations(line: string): Array<{ text: string } | { cite: Citation }> {
  const out: Array<{ text: string } | { cite: Citation }> = [];
  let last = 0;
  CITATION.lastIndex = 0;
  for (let m = CITATION.exec(line); m; m = CITATION.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    const cite = readCitation(m[0]);
    if (cite) out.push({ cite });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/**
 * A summary line with its citations removed, for somewhere they cannot work.
 *
 * A `[clf-…]` token is a control, not prose — pasted into a ticket it is noise.
 * Stripping it leaves the space that was in front of it stranded before the
 * full stop ("… in production ."), so the punctuation is closed up too.
 */
export function plain(line: string): string {
  return line
    .replace(/\[clf-[0-9:]+\]/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** `754` → `12:34`. Hours only appear once there are any. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Marked items
// ---------------------------------------------------------------------------

/**
 * A decision, an action item, or a moment somebody flagged live.
 *
 * `decision` and `action` are written by the post-call summariser; `moment` is
 * pressed by a person during the call (`calls.markMoment`, which the SDK does
 * expose). All three share one untyped JSON column, so every field is checked.
 */
export interface MarkedItem {
  type: 'decision' | 'action' | 'moment';
  text: string;
  /** Offset from the start of the call. Frequently 0 — the summariser does not
   *  always locate what it extracted, so 0 means "unplaced", not "at the start". */
  timestampSeconds: number;
}

const MARKED_TYPES = new Set(['decision', 'action', 'moment']);

export function parseMarked(raw: unknown): MarkedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MarkedItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as { type?: unknown; text?: unknown; timestampSeconds?: unknown };
    if (typeof r.type !== 'string' || !MARKED_TYPES.has(r.type)) continue;
    out.push({
      type: r.type as MarkedItem['type'],
      text: typeof r.text === 'string' ? r.text : '',
      timestampSeconds: typeof r.timestampSeconds === 'number' ? r.timestampSeconds : 0,
    });
  }
  return out.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

// ---------------------------------------------------------------------------
// The four listings
// ---------------------------------------------------------------------------

export type Listing = 'active' | 'scheduled' | 'history' | 'recordings' | 'created' | 'shared';

/** Page cursor. `startedAt` — not `startsAt`, which is null on the rows being paged. */
export interface CallCursor {
  id: string;
  startedAt: number;
}

/**
 * One page of a listing.
 *
 * Every listing goes through `rawOp` rather than `spaces.calls.*`, and it is
 * worth being precise about why, because "the SDK wrapper is fine" is the
 * default assumption: the wrappers return the SDK's `Call`, which does not
 * declare `aiSummary`, `markedItems`, `transcript`, `labels`, `startedAt` or
 * `participantPreviewUserIds`. The server sends all of them either way. Going
 * through `rawOp` is the SAME request to the SAME `/api/sdk/v1/query` endpoint
 * with the SAME op name — it just does not discard the fields on the way back.
 * (`spaces.calls.listHistory` is still what documents the op; see SDK.md.)
 */
export async function listCalls(
  kind: Listing,
  opts: { limit?: number; start?: CallCursor } = {},
): Promise<Call[]> {
  const op =
    kind === 'active'
      ? 'calls.listActive'
      : kind === 'scheduled'
        ? 'calls.listScheduled'
        : kind === 'history'
          ? 'calls.listHistory'
          : kind === 'shared'
            ? 'calls.listSharedRecordings'
            : kind === 'created'
              ? 'calls.listCreatedRecordings'
              : 'calls.listRecordings';
  const args =
    kind === 'active' || kind === 'scheduled'
      ? {}
      : { limit: opts.limit ?? 25, ...(opts.start ? { start: opts.start } : {}) };
  const rows = await rawOp<Call[]>(op, args);
  return Array.isArray(rows) ? rows : [];
}

/** The cursor that continues a listing, or null when the page was the last one. */
export function nextCursor(rows: Call[], pageSize: number): CallCursor | null {
  if (rows.length < pageSize) return null;
  const last = rows[rows.length - 1];
  const startedAt = last?.startedAt ?? last?.startsAt ?? last?.createdAt;
  return last?.id && startedAt ? { id: last.id, startedAt } : null;
}

/**
 * One call by its ROOM id.
 *
 * `getRecording` takes `externalId`, not `id`. The parameter is called `callId`
 * in the SDK, which is the row id everywhere else in the same resource — pass
 * the row id and you get `null` with no error.
 */
export async function getRecording(externalId: string): Promise<Call | null> {
  return (await rawOp<Call | null>('calls.getRecording', { callId: externalId })) ?? null;
}

/**
 * Everyone on a call, with names filled in.
 *
 * `listParticipants` returns `displayName: null, email: null` on every row — the
 * fields are declared, the server does not populate them. So the ids go through
 * the shared directory first and the caller gets rows it can render. Without
 * this the participants list is a wall of "Unknown", which is what this app
 * used to show.
 *
 * Empty is a real answer: headless recordings have no participant rows at all,
 * and carry `recordingParticipants` on the call instead (see `previewIdsOf`).
 */
export async function participantsOf(callId: string): Promise<CallParticipant[]> {
  const rows = (await rawOp<CallParticipant[]>('calls.listParticipants', { callId })) ?? [];
  await resolvePeople(rows.map(r => r.userId));
  return rows;
}

// ---------------------------------------------------------------------------
// The search index — the only track-scoped view of calls there is
// ---------------------------------------------------------------------------

/**
 * A call as the search index knows it.
 *
 * Worth the separate type: search returns things the listings do not — the
 * channel's NAME, and participant names and emails already resolved — and it
 * omits the things the listings do carry, chiefly `aiSummary` and
 * `markedItems`. The two are complementary, and the app joins them by id.
 */
export interface CallHit {
  id: string;
  externalId?: string;
  title: string;
  channelId?: string;
  channelName?: string;
  callType?: CallKind;
  status?: CallStatus;
  callOrigin?: string;
  roomLink?: string;
  startedAt?: number | null;
  endedAt?: number | null;
  createdByUserId?: string;
  userIds: string[];
  participantNames: string[];
  participantEmails: string[];
  /** The index knows whether a transcript exists — the one place that fact is
   *  exposed to an SDK caller. */
  hasTranscript: boolean;
}

/** Search echoes the query back inside `<hi>` tags. Nothing renders them, so
 *  they come off at the boundary rather than at every call site. */
function unhighlight(s: string | undefined): string {
  return (s ?? '').replace(/<\/?hi>/g, '');
}

/**
 * Find calls — the only way to ask a question of the whole workspace.
 *
 * WHY THIS EXISTS ALONGSIDE THE LISTINGS. `calls.listHistory` and friends take
 * no channel argument, so "calls on this track" used to mean reading 25 rows
 * and filtering them client-side — which reports "no calls on this track" when
 * the truth is "none in the last 25 anywhere". `search` takes `in`, and filters
 * server-side across the whole index. It is also the only free-text search over
 * calls there is.
 *
 * WHAT IT DOES NOT DO, all verified against the live index rather than assumed:
 *   - `orderBy: 'newest'` has no effect on calls. Results come back unordered
 *     and callers must sort on `startedAt` themselves; `sortHits` does.
 *   - `after` / `before` / `on` / `range` have no effect on calls either — a
 *     query for calls after 2026-09-01 returns calls from 2025. Date narrowing
 *     is done here, in `withinDays`.
 *   - `q` matches the TITLE and the participant list only. It does not reach
 *     the transcript or the summary: a phrase that appears in exactly one
 *     call's summary returns nothing. That is the biggest single gap in this
 *     surface (SCRIBE-SDK-GAPS.md §2).
 * `in`, `q`, `withUser`, `callType` and `offset` all work.
 */
export async function searchCalls(opts: {
  q?: string;
  channelId?: string;
  withUser?: string;
  callType?: CallKind;
  limit?: number;
}): Promise<CallHit[]> {
  const { spaces } = await xyne();
  const res = await spaces.search.query({
    type: 'calls',
    // Flat list. Grouped is the default and buries a single type in one bucket.
    groupBy: '',
    limit: opts.limit ?? 100,
    ...(opts.q ? { q: opts.q } : {}),
    ...(opts.channelId ? { in: opts.channelId } : {}),
    ...(opts.withUser ? { withUser: opts.withUser } : {}),
    ...(opts.callType ? { callType: opts.callType } : {}),
  });
  const rows = (res as { results?: unknown[] })?.results ?? [];
  const hits: CallHit[] = [];
  for (const raw of rows) {
    const r = raw as {
      id?: string;
      title?: string;
      metadata?: { timestamp?: string; channelName?: string };
      searchContext?: Record<string, unknown>;
    };
    const ctx = r.searchContext ?? {};
    const id = (ctx.callId as string) ?? r.id;
    if (!id) continue;
    hits.push({
      id,
      externalId: ctx.externalId as string | undefined,
      title: unhighlight((ctx.title as string) ?? r.title) || 'Untitled call',
      channelId: ctx.channelId as string | undefined,
      channelName: unhighlight((ctx.channelTitle as string) ?? r.metadata?.channelName) || undefined,
      callType: ctx.callType as CallKind | undefined,
      status: ctx.status as CallStatus | undefined,
      callOrigin: ctx.callOrigin as string | undefined,
      roomLink: ctx.roomLink as string | undefined,
      // `metadata.timestamp` is documented as ISO 8601 and arrives as an
      // epoch-milliseconds STRING for calls. Number() reads both.
      startedAt: numberish(ctx.startedAt) ?? numberish(r.metadata?.timestamp),
      endedAt: numberish(ctx.endedAt),
      createdByUserId: ctx.createdByUserId as string | undefined,
      userIds: Array.isArray(ctx.userIds) ? (ctx.userIds as string[]) : [],
      participantNames: Array.isArray(ctx.participantNames)
        ? (ctx.participantNames as string[]).map(unhighlight)
        : [],
      participantEmails: Array.isArray(ctx.participantEmails) ? (ctx.participantEmails as string[]) : [],
      hasTranscript: ctx.hasTranscript === true,
    });
  }
  return hits;
}

function numberish(v: unknown): number | null {
  if (typeof v === 'number') return v > 0 ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Newest first. The index does not order, so someone has to. */
export function sortHits<T extends { startedAt?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/** Client-side date narrowing, because the index's date filters do nothing here. */
export function withinDays<T extends { startedAt?: number | null }>(rows: T[], days: number): T[] {
  if (!days) return rows;
  const floor = Date.now() - days * 86_400_000;
  return rows.filter(r => (r.startedAt ?? 0) >= floor);
}

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

/**
 * Where to join a call that is happening or about to.
 *
 * Two shapes are in the data — `/external/call/<externalId>` for calls that
 * started in a conversation, and `/call/<externalId>?type=AUDIO` for headless
 * recordings — so the row's own `roomLink` is used whenever it has one and this
 * only fills the gap.
 */
export function roomLinkOf(ca: { roomLink?: string | null; externalId?: string }): string | null {
  if (ca.roomLink) return ca.roomLink;
  const ext = ca.externalId;
  return ext ? `https://spaces.xyne.juspay.net/external/call/${ext}` : null;
}

/**
 * Where to LISTEN to a call that has ended — a different place from the room.
 *
 * `roomLink` points at the live room, which is empty once the call is over.
 * Labelling that button "Open recording", as this surface used to, sends people
 * to a dead room to look for audio. The recording has its own route in the
 * dashboard, keyed on the same `externalId`.
 */
export function recordingLinkOf(ca: { externalId?: string }): string | null {
  return ca.externalId ? `https://app.spaces.xyne.juspay.net/recordings/${ca.externalId}` : null;
}

/* ---- from lib/callsBeyondSdk.ts --------------------------------------- */
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
