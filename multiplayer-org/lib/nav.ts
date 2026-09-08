/**
 * Where a tab is pointing.
 *
 * The surface presents itself as a browser, so a location has to be a value we
 * can put in an address bar, parse back out of one, and keep in a history
 * stack. That is all this module is: Page <-> string, plus the real https URL
 * for the one button that genuinely leaves.
 *
 * The paths deliberately mirror each host's own — github.com/o/r/pulls,
 * bitbucket.org/o/r/pull-requests — so an address copied out of here lands in
 * the right place when pasted into a real browser, and one copied in from a
 * real browser opens the right thing here.
 */
import { parseRepoRef, type HostId, type RepoRef } from './codehost';

export type RepoTab = 'pulls' | 'commits' | 'branches';

export type Page =
  | { kind: 'start' }
  | { kind: 'host'; host: HostId }
  | { kind: 'repo'; ref: RepoRef; tab: RepoTab };

export const DOMAIN: Record<HostId, string> = {
  github: 'github.com',
  bitbucket: 'bitbucket.org',
};

/** Each host spells the same three things differently. Follow their spelling. */
const SEGMENT: Record<HostId, Record<RepoTab, string>> = {
  github: { pulls: 'pulls', commits: 'commits', branches: 'branches' },
  bitbucket: { pulls: 'pull-requests', commits: 'commits', branches: 'branch' },
};

function tabFromSegment(host: HostId, segment?: string): RepoTab {
  if (!segment) return 'pulls';
  const table = SEGMENT[host];
  const hit = (Object.keys(table) as RepoTab[]).find(t => table[t] === segment);
  // 'pull' and 'pulls' and 'pull-requests' all mean the same thing to a person.
  if (hit) return hit;
  if (segment.startsWith('pull')) return 'pulls';
  if (segment.startsWith('commit')) return 'commits';
  if (segment.startsWith('branch')) return 'branches';
  return 'pulls';
}

/** What the address bar shows. Empty for the start page, which shows nothing. */
export function pageUrl(page: Page): string {
  if (page.kind === 'start') return '';
  if (page.kind === 'host') return DOMAIN[page.host];
  return `${DOMAIN[page.ref.host]}/${page.ref.slug}/${SEGMENT[page.ref.host][page.tab]}`;
}

/** What the tab strip shows. */
export function pageTitle(page: Page): string {
  if (page.kind === 'start') return 'New tab';
  if (page.kind === 'host') return page.host === 'github' ? 'GitHub' : 'Bitbucket';
  return page.ref.slug;
}

/** The real page, for the one control that deliberately leaves the app. */
export function externalUrl(page: Page): string {
  if (page.kind === 'start') return 'https://github.com';
  if (page.kind === 'host') return `https://${DOMAIN[page.host]}`;
  return `${page.ref.webUrl}/${SEGMENT[page.ref.host][page.tab]}`;
}

/**
 * Read whatever someone typed or pasted. Accepts a full URL, a bare
 * host/owner/repo, a deep link with a tab segment, and the two bare domains.
 * Returns null when it is not somewhere we can go — the caller says so rather
 * than navigating to a blank page.
 */
export function parsePageUrl(input: string): Page | null {
  const text = input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  if (!text) return { kind: 'start' };

  const [domain, ...rest] = text.split('/');
  const host: HostId | null =
    /^github\.com$/i.test(domain) ? 'github' : /^bitbucket\.org$/i.test(domain) ? 'bitbucket' : null;

  if (host && rest.length === 0) return { kind: 'host', host };

  const ref: RepoRef | null = parseRepoRef(text);
  if (!ref) return null;
  return { kind: 'repo', ref, tab: tabFromSegment(ref.host, rest[2]) };
}

/** Two pages are the same place — used to avoid stacking duplicate history. */
export function samePage(a: Page, b: Page): boolean {
  return pageUrl(a) === pageUrl(b) && a.kind === b.kind;
}
