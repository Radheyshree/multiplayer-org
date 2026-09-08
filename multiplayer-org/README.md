# demo-app

A Xyne app — same layout claw generates, so it renders the same locally and in
Spaces. Source lives at the root (`App.tsx`, `components/`), imports are
relative, and shadcn/ui + Tailwind are set up for local dev.

## Run

```bash
spaces token      # fill XYNE_TOKEN from your browser session
npm run dev
```

## Ship

```bash
spaces app publish    # first publish creates the app; later ones add a version
```

`push`/`publish` send only what you authored (`App.tsx`, `components/*`,
`lib/*`). The Vite bootstrap, `index.css`, `lib/utils`, and
`components/ui/*` are provided by claw at runtime and are never uploaded.

## Data

Import the data layer and use the SDKs:

    import { xyne } from './lib/xyne';
    const { spaces, storage } = await xyne();
    const channels = await spaces.channels.listAll();
    await storage.collection('prefs').put('theme', 'dark');

Published in Spaces the host runs these calls as the viewer; locally they use
the values in `.env`. See `lib/xyne.ts`.
