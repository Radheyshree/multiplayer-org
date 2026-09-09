/**
 * The mail thread this ticket's pull request is being discussed on.
 *
 * Three states, and the difference between them is the whole design:
 *
 *   OFFERED   A code-host notification naming this ticket exists on a desk, and
 *             nothing links them yet. One button. Linking writes to two tickets
 *             and adds a reference edge, which is not something to do to someone
 *             because they glanced at a ticket.
 *
 *   LINKED    From then on it is automatic. Every mail on that thread — new
 *             comments, approvals, replies you send from anywhere — appears in
 *             this conversation without being asked for.
 *
 *   REPLYING  Answering the mail from here. `POST /api/email/:id/reply` is the
 *             same endpoint the Desk UI uses, so the reply is a real email to
 *             the real recipients, and the sync copies it straight back.
 */
import { useEffect, useState } from 'react';
import { isNoReply, type Candidate, type DeskRef } from '../../lib/mailbridge';
import { c, eyebrow, mono } from '../../lib/theme';

export function MailBridge({
  linked,
  offered,
  syncing,
  note,
  onLink,
  onSync,
  onReply,
  previewRecipients,
  alias,
}: {
  /** Desk threads this ticket already mirrors. */
  linked: DeskRef[];
  /** Notifications that name this ticket and are not linked yet. */
  offered: Candidate[];
  busyLabel?: string;
  syncing: boolean;
  /** Last thing that happened, e.g. "2 mails copied". */
  note?: string | null;
  onLink: (candidate: Candidate) => Promise<void>;
  onSync: () => Promise<void>;
  onReply: (body: string) => Promise<void>;
  /** Who a reply would go to. Resolved lazily, only when the box opens. */
  previewRecipients?: () => Promise<string[]>;
  /**
   * The address anyone can email so their mail lands on this track.
   *
   * This is the answer to "what if someone ELSE emails about this ticket" —
   * everything else here can only see mail that reached a mailbox this
   * workspace already ingests. Null when the channel has no mail source.
   */
  alias?: string | null;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recipients, setRecipients] = useState<string[] | null>(null);

  // Show who this is going to BEFORE it goes. A reply-all on a thread you did
  // not start is the kind of thing people get wrong once and remember forever.
  useEffect(() => {
    if (!replying || !previewRecipients) return;
    let live = true;
    void previewRecipients().then(to => {
      if (live) setRecipients(to);
    });
    return () => {
      live = false;
    };
  }, [replying, previewRecipients]);

  if (linked.length === 0 && offered.length === 0 && !alias) return null;

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await onReply(body);
      setDraft('');
      setReplying(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="shrink-0 px-3 py-1.5"
      style={{ borderBottom: `1px solid ${c.line}`, background: c.inkSoft }}
    >
      {offered.map(cand => (
        <div key={cand.desk.id} className="flex items-center gap-2 py-0.5">
          <span style={{ ...eyebrow, fontSize: '9px', color: c.attention }}>
            {cand.notification.kind === 'mention' ? 'mail names this' : 'mail found'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: c.text }}>
            {/* A robot notification leads with its system and PR — that is the
                interesting part. A person's mail leads with its subject, because
                "who wrote what" is what decides whether you want it linked. */}
            {cand.notification.kind === 'mention'
              ? (cand.desk.title ?? 'Email')
              : `${cand.notification.system?.name ?? 'Email'}${
                  cand.notification.prNumber ? ` PR #${cand.notification.prNumber}` : ''
                }`}
            {cand.desk.xyneId ? ` · ${cand.desk.xyneId}` : ''}
            {cand.notification.repo ? ` · ${cand.notification.repo}` : ''}
          </span>
          <button
            onClick={() => void onLink(cand)}
            disabled={syncing}
            className="shrink-0 rounded px-2 py-0.5 text-[11px] disabled:opacity-50"
            style={{ background: c.signal, color: c.signalText }}
          >
            Link &amp; sync
          </button>
        </div>
      ))}

      {linked.length > 0 ? (
        <div className="flex items-center gap-2 py-0.5">
          <span style={{ ...eyebrow, fontSize: '9px', color: c.graphite }}>mail thread</span>
          <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: c.mute }}>
            {linked.length === 1
              ? 'Linked — new mail appears here on its own.'
              : `${linked.length} threads linked — new mail appears here on its own.`}
            {note ? ` ${note}` : ''}
          </span>
          <button
            onClick={() => void onSync()}
            disabled={syncing}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] disabled:opacity-50"
            style={{ color: c.signal }}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            onClick={() => setReplying(v => !v)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
            style={{ color: replying ? c.text : c.signal }}
          >
            {replying ? 'Cancel' : 'Reply by email'}
          </button>
        </div>
      ) : null}

      {alias ? (
        <div className="flex items-center gap-2 py-0.5">
          <span style={{ ...eyebrow, fontSize: '9px', color: c.graphite }}>anyone can email</span>
          <code
            className="min-w-0 flex-1 truncate"
            style={{ fontFamily: mono, fontSize: '10.5px', color: c.text }}
            title={`${alias} — mail sent here lands on this track, whoever sends it. Put the ticket key in the subject and it lands on the ticket.`}
          >
            {alias}
          </code>
          <button
            onClick={() => void navigator.clipboard?.writeText(alias).catch(() => {})}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
            style={{ color: c.signal }}
          >
            Copy
          </button>
        </div>
      ) : null}

      {replying ? (
        <div className="flex items-start gap-2 pt-1">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Reply to everyone on the mail thread…"
            className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px] outline-none"
            style={{ background: c.card, border: `1px solid ${c.line}`, color: c.text }}
          />
          <button
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="shrink-0 rounded-md px-2.5 py-1 text-[12px] disabled:opacity-40"
            style={{ background: c.signal, color: c.signalText }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      ) : null}

      {replying ? (
        <p className="pt-1 text-[10px]" style={{ fontFamily: mono, color: c.mute }}>
          {recipients === null
            ? 'Working out who this goes to…'
            : recipients.length === 0
              ? 'Nobody to reply to on this thread.'
              : `To ${recipients.join(', ')}`}
          {recipients?.length && recipients.every(isNoReply) ? (
            <span style={{ color: c.attention }}>
              {' '}— that address does not accept replies, so this reaches nobody.
              It is still recorded on the ticket.
            </span>
          ) : null}{' '}
          ⌘↵ to send.
        </p>
      ) : null}
    </div>
  );
}
