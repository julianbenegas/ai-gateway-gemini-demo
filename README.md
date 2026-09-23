# Margin

A small Next.js website design canvas. Talk to Gemini 3.8 Live, draw feedback, and let the agent work directly with tldraw shapes. The interface uses dark, neutral surfaces and self-hosted Geist typography inspired by Vercel Design.

## Run

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Canvas editing, HTML previews, variations, boards, and browser persistence work without credentials.

The sidebar contains only boards. The first board includes an editable sample website. Right-click a selected website for **View code** or **Export as HTML**. Use tldraw’s native tools and shortcuts to resize, duplicate, draw, annotate, group, and arrange. Its main menu includes **Add website** and **Save .tldr file**. Double-click a website to interact; click the canvas to return to drawing. **Voice is the only way to talk to the agent.** Click **Start voice** in the header, then speak. There is no chat composer, prompt shortcut, or transcript panel. The header shows Listening, Thinking, Building, and Speaking states, plus mute and end-session controls; brief notifications show canvas activity and errors.

## V2: designs, voice, and a virtual filesystem

Open `/v2`. The minimal sidebar lists your designs and creates a new one with **+**. Switching designs ends the active voice session. The last selected design reopens after refresh. Each design has independent HTML, files, notes, and drawings. The original board at `/` remains available.

**Talk & annotate** starts voice and element selection with one click. The pencil draws directly over the website. Notes and strokes are attached to DOM identifiers and stay aligned on scroll and resize. The model retrieves selection and annotations on demand; no website source is automatically injected. Drawings are supplied as geometry and DOM references, without handwriting recognition. Source view and download expose the saved `index.html`.

The agent has two tools: `read_selection` and `bash`. Bash is interpreted by `just-bash` against an in-memory filesystem in a local Node worker. The worker isolates the interpreter from Next.js and receives no application environment variables. Supported shell commands include `cat`, `sed`, `grep`, `jq`, pipes, heredocs, and `js-exec` for JavaScript. There is no Linux VM, real `node`/`npm` process, package installation, or network access. Each command starts in `/vercel/margin`. Files, directories, symlinks, modes, and binary contents under that directory survive across calls. Hard links are persisted as independent copies. Temporary paths elsewhere and shell state do not persist.

Upstash Redis stores one JSON snapshot per design, plus a small design index per browser owner. There is no command history, append-only log, or A2 dependency. Commands load a snapshot, execute in memory, and atomically apply changed files to the current snapshot. Unchanged files are preserved, so a Bash edit cannot overwrite a note saved concurrently. Concurrent edits to the same file remain last-write-wins. Read-only commands do not rewrite the snapshot. The preview renders only the self-contained `/vercel/margin/index.html`; other files are available to tools but are not served as preview URLs.

Commands have a two-minute timeout. Ending voice sends an explicit cancellation request. Running workers check for cancellation once per second, and the save operation atomically checks the same marker before committing. Cancelled commands discard their uncommitted changes. Cancellation markers expire after three minutes; they are not a command log. Switching designs waits for pending mutations before opening the next one.

The HttpOnly, SameSite=Strict `margin_v2_owner` cookie identifies the browser's design collection. Design IDs alone grant no access. The cookie lasts one year; snapshots have no automatic TTL. This remains a demo with anonymous browser ownership, not an account/login system. Clearing cookies loses access to that browser's collection. Existing Sandbox data is not migrated, as requested.

The dedicated Upstash resource is `margin-v2` in BaseHub, using the Free plan with auto-upgrade and eviction disabled. Connect `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) as server-only environment variables. Never expose these to the browser or the interpreter. For local development, pull the project's Development environment variables. Realtime separately requires the correct team's `AI_GATEWAY_API_KEY`.

External I/O: the site, designs, annotation, and Bash routes access Redis for persistence and cancellation; `/api/v2/realtime` mints a Gateway token. Vercel Sandbox is no longer used. Missing or malformed annotation metadata displays as an empty list. HTML normalization adds missing DOM identifiers after commands; preserving existing identifiers keeps annotations attached across edits.

## Vercel

Import this directory as the project's root. The normal Next.js build configuration works.

**Realtime voice requires a server-side `AI_GATEWAY_API_KEY`.** Gateway's realtime client-secret endpoint currently rejects OIDC-only requests with `Client secrets can only be minted with a Gateway API key`. Configure a Gateway key from the intended Vercel team as `AI_GATEWAY_API_KEY` in the project's production environment, then redeploy. Never prefix this variable with `NEXT_PUBLIC_` or expose its value to the browser. The team must have AI Gateway access and available usage.

`/api/realtime` exchanges the server credential for a short-lived browser token for `google/gemini-3.8-live`. Normal server-side model calls, such as visual inspection, can use Vercel OIDC, but realtime token minting requires the API key. The SDK prefers `AI_GATEWAY_API_KEY` over OIDC whenever both are available. Model access depends on the key: Gemini succeeded in the standalone reproduction after its key was replaced with one from the intended team. Do not infer availability from tests using an unverified inherited shell key.

The realtime session uses the Aoede voice, 16 kHz `audio/pcm` input, and 24 kHz `audio/pcm` output. These settings are in `src/lib/realtime-config.ts`. The model switch preserves the canvas tools and on-demand context reads.

For local voice testing, supply the same team's Gateway key through the local server environment or the project's development environment, then link the directory, pull its development configuration, and start the app:

```sh
vercel link
vercel env pull .env.local
npm run dev
```

The generated `.env.local` is ignored by Git. An automatically supplied OIDC token by itself is insufficient for realtime voice. Check which credential the server actually uses: an inherited `AI_GATEWAY_API_KEY` takes precedence over both `.env.local` and OIDC. The UI reports a setup error when Gateway rejects authentication; the server logs contain the specific cause.

tldraw 5 requires a license on production domains. Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` on Vercel and redeploy; the SDK reads it automatically. Alternatively, put the public key into `TLDRAW_LICENSE_KEY` in `src/lib/config.ts`. Local development works without a license. See https://tldraw.dev/sdk-features/license-key.

This prototype has no application login or per-user usage controls. Keep a deployed preview behind **Vercel Deployment Protection**: the token and inspection endpoints spend the team's Gateway credits. Their origin checks prevent cross-origin browser calls, but are not authentication.

## Model and state

- A board is a tldraw page.
- A website is a custom shape with `{ w, h, title, html }` props. HTML includes its CSS and JavaScript.
- A duplicate is another shape. Older copies may retain `meta.derivedFromShapeId`; there is no separate variation model or mobile-copy workflow.
- tldraw owns canvas state, selection, history, and IndexedDB persistence. Saving is asynchronous and debounced by the SDK. Boards are local to this browser and origin; there is no cloud database or multiplayer backend.
- The voice hook owns audio, connection state, and the current conversation. Conversation history is currently session-only.
- Screenshot caches are derived, in-memory data. They are never part of the document.

## Agent capabilities

Canvas context is pulled through agent tools. Nothing is injected on connection, selection changes, pointer movement, speech, board switches, or document edits. `read_board` returns current board names, layout, annotation records, selection, websites inside selected frames/groups, hovered/editing shapes, visible IDs, and pointer position. It omits website HTML. `read_shapes` retrieves full records and HTML for the specific IDs the agent needs, from any board. The prompt tells the agent to look up fresh context for requests like “change this,” while reusing known source for clear continuations. An empty selection is normal and does not prevent edits. Reads are guidance for the agent, not a validation gate on writes.

`apply_actions` creates, updates, deletes, duplicates, groups, reparents, arranges, selects, and focuses shapes through the editor. Only the action list is required. Updates infer the existing shape type. Optional `pageId` controls where new shapes go; it does not restrict updates to the open board. Native tldraw shapes remain available alongside website shapes. Results report actual created/updated/deleted IDs and any missing targets, so an ignored or unavailable target is not mistaken for a completed edit.

Edits are last-write-wins with tldraw undo. There is no model-supplied hash, HTML length cap, action-count cap, or selection/current-board prerequisite. For localized copy or CSS changes, `edit_html` applies short literal search/replace pairs to the current HTML, in order. It reports match counts and returns the current source if a search misses; `all: true` replaces every occurrence, otherwise only the first. Full source replacement remains available through `apply_actions`. Both can use source already in context; reading and visual inspection are tools to use when helpful, not mandatory steps. tldraw still validates its records. Invalid writes roll back inside the editor transaction and return a tool error without crashing the canvas. Incomplete or malformed tool JSON leaves the canvas untouched and returns a tool error to the model without disconnecting voice. An incomplete-only response gets one automatic continuation per spoken turn; cancelled or interrupted responses do not restart. The SDK continues responses containing valid tool calls. All completed responses record status, provider reason/error code, and available input/output/cache token counts in the console and the last 100 entries of localStorage under `margin-voice-diagnostics`. These diagnostic records exclude HTML, audio, and transcripts and are not uploaded. Failed/incomplete responses show a notice while voice remains connected. After 45 seconds without response progress, a waiting notice appears; it clears when progress resumes and does not cancel work or impose a generation time limit. A fatal editor error stops the voice session. Tool calls are deduplicated within the connection. Operations outside the exposed schemas, such as native menu commands and asset uploads, are not automatically available to the model.

## External I/O and visual context

There are two model paths:

1. **Realtime:** microphone audio goes through AI Gateway to Gemini 3.8 Live. Canvas state and website source are shared only in response to the agent’s tool calls. The agent can request this information even with no selection; there are no automatically injected board messages and the user does not type agent messages. Microphone capture begins only after the user starts a session and grants permission. Mute and end stop its audio tracks. No separate input transcription service is requested.
2. **Visual inspection:** when useful, `inspect_canvas` captures the current viewport and calls `/api/inspect`, which sends the image and positional shape context (without website source) through Gateway to `google/gemini-3.8-flash`. It returns visual observations to the live model. This separate billed request is optional for edits. An empty viewport returns an observation directly. The installed Gateway realtime event schema has no image input event.

Website iframes use `sandbox="allow-scripts"` without same-origin access. A small capture bridge uses `html-to-image` inside the iframe, returning pixels through a one-shot `MessageChannel`. The website shape's SVG export uses those pixels, so normal tldraw export can combine the website and annotations. Capture never grants the iframe access to the editor document. The iframe CSP blocks network APIs, form submission, and external scripts other than this app's capture bundle.

Capture works best for self-contained HTML with system fonts, inline SVG, and embedded images. Remote fonts, cross-origin images, video, and WebGL content are not reliably represented. Capture failures are reported to the agent. Custom fonts are intentionally skipped by the capture library. Interacting with an iframe can change its scroll or DOM state; annotations remain canvas shapes and do not track DOM elements.

tldraw fonts, icons, and translations and the capture library are self-hosted; `postinstall` copies assets from the installed packages. Geist fonts are bundled through `next/font` from the `geist` package. Generated websites may display external images or fonts if their HTML references them. tldraw's license-dependent telemetry is governed by its SDK license.

## Review map

- `src/components/website-shape.tsx`: the custom shape, iframe, and screenshot export.
- `src/components/canvas-menus.tsx`: website source/export and creation inside native tldraw menus.
- `src/lib/tools.ts`: tool schemas and live model instructions.
- `src/lib/voice-diagnostics.ts`: local response status/usage diagnostics.
- `src/lib/canvas-agent.ts`: reads, validated mutations, rollback, and visual inspection.
- `src/components/voice-session.tsx`: board voice controls.
- `src/components/use-voice-agent.ts`: shared audio lifecycle, tool routing, and response recovery.
- `src/components/v2/site-studio.tsx`: v2 preview, toolbar, selection, and annotations.
- `src/lib/v2/workspace.ts`: owner-scoped Redis snapshots and virtual file operations.
- `public/v2-preview.js`: iframe element selection and annotation positioning.
- `src/lib/realtime-config.ts`: model-compatible audio and voice settings.
- `src/app/api/realtime/route.ts` and `src/app/api/inspect/route.ts`: all server-side model I/O.
- `src/components/workspace.tsx`: board navigation, design actions, and local persistence.

## Verify

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Browser tests use a simulated Gateway WebSocket with the real editor, tool executor, preview capture, and browser microphone pipeline. They cover voice-only interaction, audio lifecycle, malformed tool recovery, interruption, duplication, HTML replacements with undo, and on-demand canvas reads. The context regression confirms that connection, selection, speech, document changes, and board switches inject no text messages, while tool reads return fresh state.

A live Gateway check on September 16 requested the heading “Great” with no selection and zero injected messages. GPT Realtime 2 called `read_board`, then `read_shapes`, then `edit_html`, and the heading changed successfully. An earlier full-page test using automatic context added five sections in a single 11,197-character update and completed in 56 seconds including the spoken prompt. These tests used an API key, not OIDC-only authentication, and do not establish the cause of previously unrecorded production stalls. V2 browser regressions additionally cover independent designs, sidebar switching, and one-click activation, DOM-bound notes, selection refresh after edits, deleted targets, persistence after reload, and cancellation during workspace setup. A live Redis/API check verified persisted HTML, JavaScript edits, independent designs, owner isolation, binary files and directories, cancellation, and preservation of an annotation saved concurrently with a Bash edit. An isolated copy of the files traced for deployment also ran the JavaScript worker successfully. Model design quality still needs hands-on evaluation.

Dependencies are pinned; AI SDK packages were refreshed on September 22, 2026: Next.js 16.3.5, React 19.3.0, tldraw 5.4.2, AI SDK 7.0.110, Gateway 4.0.89, and the React AI SDK 4.0.113. See `package-lock.json` for all resolved versions.
