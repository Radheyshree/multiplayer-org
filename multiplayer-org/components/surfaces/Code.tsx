/**
 * GitHub & Bitbucket.
 *
 * The surface is a browser: tabs, an address bar and history live in
 * Browser.tsx, the new-tab page in Start.tsx, and a repository's pull requests,
 * commits and branches in Repo.tsx. Nothing here opens a new browser tab any
 * more — the ↗ control in the chrome is the one deliberate way out.
 */
import { Browser } from './Browser';

export function Code() {
  return <Browser />;
}
