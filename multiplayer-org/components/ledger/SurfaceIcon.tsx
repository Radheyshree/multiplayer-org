/**
 * A picture of where a line came from.
 *
 * The badges used to be text marks — ⑂ ✉ ◉ ◇ — chosen because they cost no
 * bundle and no network. They read as decoration. Nobody scanning a thread
 * decodes a glyph; they see a shape and know, or they read the words and are
 * slowed down. When every row carries a badge, that difference is the
 * difference between a thread you skim and a thread you parse.
 *
 * So: real icons, one per system, from lucide (already a dependency, and
 * tree-shaken to the handful named here). Deliberately NOT brand logos —
 * shipping a Bitbucket or Gmail mark would mean bundling someone's trademark
 * as a data URI, and the generic shapes are the ones people already know from
 * every other tool.
 *
 * The mapping is by SYSTEM first and category second, because "which product"
 * is what the reader wants and "which category" is only the fallback: a pull
 * request looks like a pull request whether it is on Bitbucket or GitHub, and
 * mail looks like mail whether it came through Zoho or Gmail.
 */
import {
  Bot,
  Cog,
  Diamond,
  ExternalLink,
  GitPullRequest,
  Hash,
  Mail,
  Megaphone,
  Phone,
  Sparkles,
  Store,
} from 'lucide-react';
import type { Source } from '../../lib/provenance';
import type { SystemId } from '../../lib/origin';

type Icon = typeof Mail;

const BY_SYSTEM: Partial<Record<SystemId, Icon>> = {
  bitbucket: GitPullRequest,
  github: GitPullRequest,
  gitlab: GitPullRequest,
  zoho: Mail,
  gmail: Mail,
  outlook: Mail,
  slack: Hash,
  ozonetel: Phone,
  playstore: Store,
  xyne: Diamond,
  web: ExternalLink,
};

const BY_CATEGORY: Record<string, Icon> = {
  code: GitPullRequest,
  email: Mail,
  slack: Hash,
  call: Phone,
  social: Megaphone,
  automation: Cog,
  agent: Sparkles,
  app: Bot,
  xyne: Diamond,
};

/** The icon for a resolved source. Never null — every source has a shape. */
export function SurfaceIcon({
  source,
  size = 11,
  className,
}: {
  source: Pick<Source, 'id' | 'system'>;
  size?: number;
  className?: string;
}) {
  const Glyph =
    (source.system ? BY_SYSTEM[source.system.id] : undefined) ??
    BY_CATEGORY[source.id] ??
    Diamond;
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      className={className}
      aria-hidden
      // Icons sit on a text baseline beside 9.5px type; without this they push
      // the row a pixel taller than its neighbours and the badges stop aligning.
      style={{ display: 'block', flexShrink: 0 }}
    />
  );
}
