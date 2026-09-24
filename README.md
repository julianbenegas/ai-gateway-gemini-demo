# Margin

Voice-first website design with Gemini 3.8 Live through AI Gateway. Two surfaces:

- **`/` — canvas.** A tldraw board where websites are shapes. The agent reads the board, edits HTML, and draws with native tldraw shapes. The board is saved to Redis and rendered on the server.
- **`/v2` — studio.** A single website you point at, draw on, and annotate. The agent edits its `index.html`.

Voice is the only way to talk to the agent. There is no chat.

## Run

Requires Node.js 24 and pnpm.

```sh
pnpm install
vercel link && vercel env pull .env.local
pnpm dev
```

Realtime voice needs a server-side `AI_GATEWAY_API_KEY` (a `vck_` Gateway key): Gateway will not mint realtime client secrets from OIDC alone. Boards and designs are stored in Upstash Redis via `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` equivalents). Keep all of these server-only. Without Redis in development, canvas boards fall back to server memory.

A shell-level `AI_GATEWAY_API_KEY` overrides `.env.local`, so unset it if the dev server should use the project's key.

`pnpm-workspace.yaml` sets `minimumReleaseAge` to two days, mirroring npm's `min-release-age`.

## Layout

```
src/
  app/        routes and API handlers only
  canvas/     "/" — server-rendered shell, client-only tldraw editor, website shape, tools and agent
  canvas/server/  Redis-backed board store
  studio/     "/v2" — studio UI, preview bridge client, tools
  studio/server/  Redis-backed design store
  voice/      realtime hook, voice controls, session config, token minting
  ui/         shared primitives (button, dialog, notice, labels)
  lib/        cross-cutting helpers (CSP, replacements, config)
public/studio-bridge.js   selection and annotation script injected into the studio iframe
```

Styling is Tailwind 4 with tokens in `src/app/globals.css`: Geist Mono and the forums.basehub.com palette, including its orange accent, following the system color scheme. tldraw draws its selection overlays from a JS theme, so `canvas/workspace.tsx` mirrors the accent there. Sidebars are resizable and remember their width per browser.

## Agent tools

Nothing is injected into the conversation; the agent pulls context through tools.

**Canvas:** `read_board` (layout, selection, and pointer, without HTML), `read_shapes` (full records including HTML), `edit_html` (literal search/replace), `apply_actions` (create, update, arrange, and delete shapes), `inspect_canvas` (screenshot described by `google/gemini-3.8-flash`, because Gateway realtime has no image input).

**Studio:** `read_selection` (DOM selection, notes, and drawings anchored to elements), `read_html`, `edit_html` (literal search/replace), `write_html` (full rewrite).

Edits are validated and last-write-wins. Canvas edits are undoable through tldraw. The canvas saves the whole tldraw snapshot to Redis shortly after each change; the page loads it in a Server Component, so the sidebar, header, and saved sidebar width render before tldraw loads and nothing shifts. Studio designs are one Redis hash each, with separate `html` and `annotations` fields, so a saved note never overwrites a concurrent page edit. Each edit re-adds missing `data-margin-id` attributes so annotations stay attached. An `HttpOnly` cookie scopes boards and designs to the browser; this is a demo, not an account system.

Websites render in `sandbox="allow-scripts"` iframes, with a CSP that blocks network access and only allows this origin's scripts.

## Deploy

Import the directory as the project root. Set `AI_GATEWAY_API_KEY` and the Redis variables in the project environment.

- **tldraw license.** tldraw 5 needs a license on production domains: set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`.
- **Deployment Protection.** Keep previews behind it. The token and inspection routes spend Gateway credits, and the origin checks are not authentication.

## Verify

```sh
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test
```

Browser tests drive the real editor, preview bridge, and microphone pipeline against a simulated Gateway WebSocket and mocked studio APIs. They start their own dev server on port 3100 (`NEXT_DIST_DIR=.next-test`, so it runs beside yours) with `MARGIN_STORE=memory`, so they never write to Redis.
