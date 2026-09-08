/**
 * The shell — an ink rail of ports down the left, paper canvas to the right.
 *
 * The rail is the patch bay: every pinned app is a port, and the one you're in
 * carries a lit LED. It is the only persistent chrome, so opening an app never
 * costs you your place in the org.
 */
import type { ReactNode } from 'react';
import { c, eyebrow, mono } from '../lib/theme';
import type { Entry } from '../lib/apps';

export function Shell({
  pinned,
  activeKey,
  onOpen,
  onStore,
  identity,
  children,
}: {
  pinned: Entry[];
  activeKey: string | null;
  onOpen: (e: Entry) => void;
  onStore: () => void;
  identity: { name: string; workspace: string } | null;
  children: ReactNode;
}) {
  const inStore = activeKey === null;

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: c.paper, color: c.text }}>
      <nav
        className="flex w-56 shrink-0 flex-col justify-between"
        style={{ background: c.ink, borderRight: `1px solid ${c.inkLine}` }}
      >
        <div>
          <div className="px-4 pt-5 pb-4">
            <div style={{ ...eyebrow, color: c.mute }}>Xyne</div>
            <div className="mt-1 text-[15px] font-semibold tracking-tight" style={{ color: c.paper }}>
              Switchboard
            </div>
          </div>

          <div className="px-3 pb-1" style={{ ...eyebrow, color: c.mute }}>
            Ports
          </div>

          <ul className="px-2">
            {pinned.map(app => {
              const active = activeKey === app.key;
              return (
                <li key={app.key}>
                  <button
                    onClick={() => onOpen(app)}
                    className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors"
                    style={{ background: active ? c.inkSoft : 'transparent' }}
                  >
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded text-[12px]"
                      style={{
                        background: active ? c.signal : c.inkLine,
                        color: active ? '#fff' : c.mute,
                      }}
                      aria-hidden
                    >
                      {app.glyph}
                    </span>
                    <span
                      className="flex-1 truncate text-[13px]"
                      style={{ color: active ? c.paper : '#B9BECC' }}
                    >
                      {app.name}
                    </span>
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: active ? c.live : 'transparent' }}
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-2 pb-3">
          <button
            onClick={onStore}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left"
            style={{ background: inStore ? c.inkSoft : 'transparent' }}
          >
            <span
              className="grid size-6 shrink-0 place-items-center rounded text-[12px]"
              style={{ background: inStore ? c.signal : c.inkLine, color: inStore ? '#fff' : c.mute }}
              aria-hidden
            >
              ⬡
            </span>
            <span className="text-[13px]" style={{ color: inStore ? c.paper : '#B9BECC' }}>
              All apps
            </span>
          </button>

          {identity && (
            <div className="mt-3 border-t px-2 pt-3" style={{ borderColor: c.inkLine }}>
              <div className="truncate text-[12px]" style={{ color: '#B9BECC' }}>
                {identity.name}
              </div>
              <div className="truncate" style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
                {identity.workspace}
              </div>
            </div>
          )}
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
