# Margin

A small Next.js website design canvas. Talk to GPT Realtime 2, draw feedback, and let the agent work directly with tldraw shapes. The interface uses dark, neutral surfaces and self-hosted Geist typography inspired by Vercel Design.

## Run

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Canvas editing, HTML previews, variations, boards, and browser persistence work without credentials.

The first board contains an editable sample website. Select it to open **Code**, make a **Variation**, create a **Mobile** copy, or **Interact** with it. Use tldraw's normal tools to draw, annotate, group, and arrange. Double-click a website to interact; click the canvas to return to drawing. **Voice is the only way to talk to the agent.** Click **Start voice** in the header, then speak. There is no chat composer, prompt shortcut, or transcript panel. The header shows listening/speaking status, mute, and end-session controls; brief notifications show canvas activity and errors.

## Vercel

Import this directory as the project's root. The normal Next.js build configuration works.

AI Gateway uses the Vercel project's automatically supplied OIDC credentials. There are **no manually configured API-key environment variables**. The team must have AI Gateway access and available usage. `/api/realtime` exchanges the server credential for a short-lived browser token for `openai/gpt-realtime-2`.

The realtime session uses the Marin voice and 24 kHz `audio/pcm` for both input and output. These settings are in `src/lib/realtime-config.ts`. The switch from Gemini required these audio settings as well as the model ID; the canvas tool contract stays the same.

For local voice testing, link the directory to your Vercel project, pull its development credentials, and start the app:

```sh
vercel link
vercel env pull .env.local
npm run dev
```

The generated `.env.local` includes a temporary OIDC token and is ignored by Git. Refresh it with `vercel env pull .env.local` and restart the server if authentication expires. Plain `npm run dev` does not create Vercel authentication. The UI reports a setup error when credentials are unavailable.

tldraw 5 requires a license on production domains. Put your public license key into `TLDRAW_LICENSE_KEY` in `src/lib/config.ts`; no environment variable is necessary. Local development works without a license. See https://tldraw.dev/sdk-features/license-key.

This prototype has no application login or per-user usage controls. Keep a deployed preview behind **Vercel Deployment Protection**: the token and inspection endpoints spend the team's Gateway credits. Their origin checks prevent cross-origin browser calls, but are not authentication.

## Model and state

- A board is a tldraw page.
- A website is a custom shape with `{ w, h, title, html }` props. HTML includes its CSS and JavaScript.
- A variation is another shape. Copies made by the UI carry `meta.derivedFromShapeId`.
- tldraw owns canvas state, selection, history, and IndexedDB persistence. Saving is asynchronous and debounced by the SDK. Boards are local to this browser and origin; there is no cloud database or multiplayer backend.
- The voice hook owns audio, connection state, and the current conversation. Conversation history is currently session-only.
- Screenshot caches are derived, in-memory data. They are never part of the document.

## Agent capabilities

`read_board` returns shape summaries, selection, pointer, viewport, and page coordinates. `read_shapes` retrieves complete records, including website HTML. `apply_actions` executes validated create, update, delete, duplicate, group, ungroup, reparent, align, distribute, stack, reorder, select, and focus operations through the editor. Native tldraw shapes remain available alongside website shapes.

Each action batch has an undo boundary and rolls back on failure. Page IDs stop a delayed action from editing the wrong board. Website HTML updates require the hash returned by `read_shapes`, so the agent cannot silently overwrite newer source. Tool calls are deduplicated within the current voice connection. Operations outside the exposed schemas, such as native menu commands and asset uploads, are not automatically available to the model.

## External I/O and visual context

There are two model paths:

1. **Realtime:** microphone audio, board summaries, requested shape source, and tool results go through AI Gateway to GPT Realtime 2. Board context is still sent as structured text internally; the user does not type agent messages. Microphone capture begins only after the user starts a session and grants permission. Mute and end stop its audio tracks. No separate input transcription service is requested.
2. **Visual inspection:** the agent's `inspect_canvas` tool captures the current viewport and calls `/api/inspect`, which sends that image and shape context through Gateway to `google/gemini-3.8-flash`. It returns visual observations to the live model. This is a separate billed model request, made on inspection rather than every stroke. The current installed Gateway realtime event schema has no image input event.

Website iframes use `sandbox="allow-scripts"` without same-origin access. A small capture bridge uses `html-to-image` inside the iframe, returning pixels through a one-shot `MessageChannel`. The website shape's SVG export uses those pixels, so normal tldraw export can combine the website and annotations. Capture never grants the iframe access to the editor document. The iframe CSP blocks network APIs, form submission, and external scripts other than this app's capture bundle.

Capture works best for self-contained HTML with system fonts, inline SVG, and embedded images. Remote fonts, cross-origin images, video, and WebGL content are not reliably represented. Capture failures are reported to the agent. Custom fonts are intentionally skipped by the capture library. Interacting with an iframe can change its scroll or DOM state; annotations remain canvas shapes and do not track DOM elements.

tldraw fonts, icons, and translations and the capture library are self-hosted; `postinstall` copies assets from the installed packages. Geist fonts are bundled through `next/font` from the `geist` package. Generated websites may display external images or fonts if their HTML references them. tldraw's license-dependent telemetry is governed by its SDK license.

## Review map

- `src/components/website-shape.tsx`: the custom shape, iframe, and screenshot export.
- `src/lib/tools.ts`: tool schemas and live model instructions.
- `src/lib/canvas-agent.ts`: reads, validated mutations, rollback, and visual inspection.
- `src/components/voice-session.tsx`: compact voice controls, context updates, tool routing, and microphone lifecycle.
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

Browser tests use a simulated Gateway WebSocket while running the real editor, tool executor, preview capture, and browser microphone pipeline. They cover voice-only interaction, 24 kHz configuration, mute/unmute, and cancellation of pending microphone access. A separate manual check with the linked BaseHub project's credentials sent synthesized speech to GPT Realtime 2 and received a completed spoken reply with all four tools registered. This verifies the audio exchange; model design quality still needs hands-on evaluation.

Dependencies are pinned to the latest npm releases resolved on September 15, 2026: Next.js 16.3.5, React 19.3.0, tldraw 5.4.2, AI SDK 7.0.102, Gateway 4.0.82, and the React AI SDK 4.0.105. See `package-lock.json` for all resolved versions.
