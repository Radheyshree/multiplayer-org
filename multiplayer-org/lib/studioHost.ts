/**
 * The module graph a generated app is allowed to import.
 *
 * A generated app is not bundled — it is transpiled and evaluated inside this
 * document (see lib/studioRuntime.ts), so `import` has to resolve against
 * something we hold in hand. This is that something: real module objects, the
 * same ones Studio itself renders with.
 *
 * Two consequences worth stating, because they are the point rather than a
 * side effect:
 *
 *  - Generated code shares OUR React. There is no second copy, so hooks work
 *    and a preview can hand components back across the boundary.
 *  - `xyne` is the live data layer. An app generated here can read the viewer's
 *    real tickets, channels and search results in the preview, before it has
 *    been saved anywhere. That is the difference between a mockup and a thing.
 *
 * Everything here already exists in a published Space: shadcn/ui and `cn` are
 * injected by the host, and lucide/clsx/cva/tailwind-merge are in the sandbox's
 * BASE_DEPENDENCIES, so none of it needs a manifest entry.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as lucide from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { cva } from 'class-variance-authority';

import { cn } from './utils';
import { xyne, spaces, storage } from './xyne';

import * as accordion from '../components/ui/accordion';
import * as alert from '../components/ui/alert';
import * as avatar from '../components/ui/avatar';
import * as badge from '../components/ui/badge';
import * as button from '../components/ui/button';
import * as card from '../components/ui/card';
import * as checkbox from '../components/ui/checkbox';
import * as dialog from '../components/ui/dialog';
import * as dropdownMenu from '../components/ui/dropdown-menu';
import * as input from '../components/ui/input';
import * as label from '../components/ui/label';
import * as popover from '../components/ui/popover';
import * as progress from '../components/ui/progress';
import * as scrollArea from '../components/ui/scroll-area';
import * as select from '../components/ui/select';
import * as separator from '../components/ui/separator';
import * as sheet from '../components/ui/sheet';
import * as skeleton from '../components/ui/skeleton';
import * as switchUi from '../components/ui/switch';
import * as table from '../components/ui/table';
import * as tabs from '../components/ui/tabs';
import * as textarea from '../components/ui/textarea';
import * as tooltip from '../components/ui/tooltip';

/** Bare specifiers. */
const PACKAGES: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'lucide-react': lucide,
  clsx: { clsx, default: clsx },
  'tailwind-merge': { twMerge, default: twMerge },
  'class-variance-authority': { cva },
  xyne: { xyne, spaces, storage, default: xyne },
};

/** Host-provided paths. Keyed without extension; the resolver strips them. */
const PROVIDED: Record<string, unknown> = {
  '/lib/utils': { cn },
  '/components/ui/accordion': accordion,
  '/components/ui/alert': alert,
  '/components/ui/avatar': avatar,
  '/components/ui/badge': badge,
  '/components/ui/button': button,
  '/components/ui/card': card,
  '/components/ui/checkbox': checkbox,
  '/components/ui/dialog': dialog,
  '/components/ui/dropdown-menu': dropdownMenu,
  '/components/ui/input': input,
  '/components/ui/label': label,
  '/components/ui/popover': popover,
  '/components/ui/progress': progress,
  '/components/ui/scroll-area': scrollArea,
  '/components/ui/select': select,
  '/components/ui/separator': separator,
  '/components/ui/sheet': sheet,
  '/components/ui/skeleton': skeleton,
  '/components/ui/switch': switchUi,
  '/components/ui/table': table,
  '/components/ui/tabs': tabs,
  '/components/ui/textarea': textarea,
  '/components/ui/tooltip': tooltip,
};

/** React itself, injected into every evaluated module for the classic JSX transform. */
export const hostReact = React;

/** Resolve a specifier the host owns, or undefined if the app must provide it. */
export function resolveHostModule(specifier: string, fromDir: string): unknown {
  if (specifier in PACKAGES) return PACKAGES[specifier];

  const absolute = specifier.startsWith('.') ? joinPath(fromDir, specifier) : specifier;
  const bare = absolute.replace(/\.[jt]sx?$/, '');
  return PROVIDED[bare];
}

/** POSIX-ish join for the virtual file tree. No `..` beyond the root. */
export function joinPath(fromDir: string, specifier: string): string {
  const parts = `${fromDir}/${specifier}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

/** Names offered to the model, and shown in the UI so the contract is visible. */
export const HOST_MODULE_NAMES = [...Object.keys(PACKAGES), ...Object.keys(PROVIDED)];
