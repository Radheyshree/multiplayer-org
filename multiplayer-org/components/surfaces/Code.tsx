/**
 * GitHub & Bitbucket.
 *
 * The surface is a browser: tabs, an address bar and history live in
 * Browser.tsx, the new-tab page in Start.tsx, and a repository's pull requests,
 * commits and branches in Repo.tsx. Nothing here opens a new browser tab any
 * more — the ↗ control in the chrome is the one deliberate way out.
 *
 * Its contribution to a ticket is the ATTACH control in the chrome: whatever
 * page you are on — a repo, a pull request, a commit list — can be recorded
 * against the focused ticket as a real link. That is the whole reason a code
 * host belongs inside this shell rather than in another browser window: the
 * connection between the change and the ticket stops living in someone's head.
 */
import { Browser } from './Browser';
import type { OrgAppProps } from '../../orgApps/registry';

export function Code({ postUpdate, focused }: OrgAppProps) {
  return <Browser postUpdate={postUpdate} focused={focused} />;
}
