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
import { rawOp, xyne } from './xyne';
import { resolvePeople } from './people';

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
