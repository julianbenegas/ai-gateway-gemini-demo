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

## V2: one website, remote source

Open `/v2` for the site-focused demo. **Talk & annotate** starts the microphone and enables element selection with one click (or keeps the pencil active if already drawing). Select an element, speak a change, or attach a note with the annotation button. The **pencil** draws freehand directly over the website, without needing a selection or voice connection. Drawings save automatically; undo removes the last saved stroke, and the annotations list can delete individual marks. **View source** and **Download HTML** expose the actual saved `index.html`. The board at `/` remains available.

The v2 agent has two tools: `read_selection` and `bash`. Selection context is requested on demand and never injected into the model automatically. `read_selection` includes current DOM text, HTML, an element identifier, notes, and freehand paths. A drawing stores points relative to the common DOM ancestor under the stroke, plus references to elements crossed or enclosed by its bounds. Marks follow their anchor on scroll and resize; if an anchor is deleted, its original reference remains available but the stroke is hidden. The agent receives geometry and DOM references, not a screenshot or handwriting recognition.

`bash` runs real commands in the remote Sandbox with `/vercel/margin` as the working directory. It can read/write files, run scripts, install packages, and use the Sandbox's network access. Each call gets a fresh shell and returns `stdout`, `stderr`, and `exitCode`; shell variables and directory changes do not carry across calls. Files persist. Commands have a two-minute execution timeout, and aborting the request kills the running command. No application credentials are passed into the shell. After completion (including a nonzero exit), the app reads `index.html` and refreshes the preview. Only command output is returned to the agent; the source is not automatically appended to its context. The preview still renders a self-contained `index.html`, not a dev server or additional Sandbox files. Background changes are visible on the next tool completion or page reload.

Each browser session gets a persistent Vercel Sandbox when it first starts voice or saves a note or drawing. Files live at `/vercel/margin/index.html` and `/vercel/margin/annotations.json`. An unguessable HttpOnly, SameSite=Strict cookie identifies that workspace; it is not returned in model context. Other browsers start with their own site. This is a bearer session capability, not an account/login system: anonymous workspace creation and model usage still require deployment-level access/spend controls for a public service.

Sandbox authentication uses the linked project's Vercel OIDC credentials. Production credentials are supplied by Vercel. Locally, run `vercel env pull` for a fresh project token. Sandbox receives no Gateway key. Realtime still requires the correct team's `AI_GATEWAY_API_KEY`; do not substitute an unverified inherited shell key.

Sandbox sessions stop after five minutes and automatically resume on the next file operation. Persistence keeps the last automatic snapshot; the default snapshot retention and browser cookie lifetime are 30 days. Refreshing the page reads the remote files. App-managed writes use an atomic rename; Bash writes use whatever the command specifies. UI mutations are sequenced within the tab. This prototype is not a collaborative editor; concurrent edits in separate tabs can overwrite each other.

Server-side HTML normalization adds stable `data-margin-id` attributes when source is loaded. Existing identifiers are retained; new elements get new identifiers. Notes and drawings track those elements through scrolling, resizing, and source updates. If a target disappears, its annotation retains the original reference and is marked detached rather than silently attaching elsewhere. Full rewrites that discard identifiers detach old annotations. A missing `index.html` produces an empty preview that can be repaired through Bash. Missing or malformed `annotations.json` is displayed as an empty annotation list without rewriting the file on read.

The preview remains a sandboxed iframe with a MessageChannel bridge. It can run its own inline JavaScript but cannot access the editor document or call APIs. The bridge supplies selection context and positions the annotation pins and drawings. Bash runs server-side in the visitor's remote Sandbox, independently of the preview iframe.

New external I/O: `/api/v2/site` and `/api/v2/annotations` read/write the session's Vercel Sandbox; `/api/v2/bash` executes commands in that Sandbox and refreshes the saved source; `/api/v2/realtime` mints a Gateway token after checking that the workspace exists. Merely opening a new `/v2` page displays the starter without provisioning a Sandbox.

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
- `src/lib/v2/workspace.ts`: cookie-scoped Sandbox storage and atomic file writes.
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

A live Gateway check on September 16 requested the heading “Great” with no selection and zero injected messages. GPT Realtime 2 called `read_board`, then `read_shapes`, then `edit_html`, and the heading changed successfully. An earlier full-page test using automatic context added five sections in a single 11,197-character update and completed in 56 seconds including the spoken prompt. These tests used an API key, not OIDC-only authentication, and do not establish the cause of previously unrecorded production stalls. V2 browser regressions additionally cover one-click activation, DOM-bound notes, selection refresh after edits, deleted targets, persistence after reload, and cancellation during workspace setup. A separate live Sandbox/API check saved HTML and a note, stopped the VM, reloaded through the API, and confirmed both persisted while an anonymous visitor could not write. Model design quality still needs hands-on evaluation.

Dependencies are pinned; AI SDK packages were refreshed on September 22, 2026: Next.js 16.3.5, React 19.3.0, tldraw 5.4.2, AI SDK 7.0.110, Gateway 4.0.89, and the React AI SDK 4.0.113. See `package-lock.json` for all resolved versions.
