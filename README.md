# Margin

Voice-first website design with Gemini 3.8 Live through AI Gateway. Each example is a self-contained route, with its own UI, API, auth, and agent loop:

- **`/v1/<board>` — canvas.** A tldraw board where websites are shapes. The agent reads the board, edits HTML, and draws with native tldraw shapes. The board is saved to Redis and rendered on the server.
- **`/v2/<design>` — studio.** A website you point at, draw on, and annotate. New designs start empty, with a prompt to talk, and the agent writes them.

`/` redirects to `/v1`. Voice is the only way to talk to the agent. There is no chat.

## Run

Requires Node.js 24 and pnpm.

```sh
pnpm install
vercel link && vercel env pull .env.local
pnpm dev
```

Realtime voice needs a server-side `AI_GATEWAY_API_KEY` (a `vck_` Gateway key): Gateway will not mint realtime client secrets from OIDC alone. Boards and designs are stored in Upstash Redis via `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` equivalents). Keep all of these server-only. Without Redis in development, or with `MARGIN_STORE=memory`, `lib/redis.ts` uses an in-memory stand-in for the few commands the app runs.

A shell-level `AI_GATEWAY_API_KEY` overrides `.env.local`, so unset it if the dev server should use the project's key.

`pnpm-workspace.yaml` sets `minimumReleaseAge` to two days, mirroring npm's `min-release-age`.

## Layout

```
src/
  app/
    v1/                  canvas example
      page.tsx           Server Component: loads the board, renders the shell
      api/[[...path]]/   mounts the example's Elysia API
      _server/           auth (owner cookie), Redis store, Elysia API
      _lib/              tools, agent, voice loop, typed API client
      _components/       workspace, tldraw editor, website shape, menus
    v2/                  studio example, same shape
  ui/                    pure UI components shared by the examples
  lib/                   shared libraries: Elysia defaults, RPC client, Redis,
                         owner cookie, realtime token, CSP, replacements
public/v2/preview-bridge.js   selection and annotation script injected into the studio iframe
```

Everything specific to an example lives in its folder, including the voice loop (`_lib/use-voice-agent.ts`), so examples can diverge freely. Underscore folders are private in the App Router and never become routes.

**API.** Each example's `_server/api.ts` is an Elysia app mounted at `/<example>/api`, validated with the same zod schemas the tools use. The browser calls it through Eden (`_lib/rpc.ts`), so requests and responses are typed end to end. `lib/api.ts` rejects cross-origin writes and maps errors to `{ error }` responses. Declare route handlers `async`; Elysia only catches rejected promises from async functions.

Styling is Tailwind 4 with tokens in `src/app/globals.css`: Geist Mono and forums.basehub.com's dark palette with its orange accent. The app is dark only, tldraw included; website previews keep their own colors. tldraw draws its selection overlays from a JS theme, so `v1/_components/canvas-editor.tsx` mirrors the accent there. Sidebars are resizable; their width is kept in a cookie so the server renders it.

## Agent tools

Nothing is injected into the conversation; the agent pulls context through tools.

**Canvas:** `read_board` (layout, selection, and pointer, without HTML), `read_shapes` (full records including HTML), `edit_html` (literal search/replace), `apply_actions` (create, update, arrange, and delete shapes), `inspect_canvas` (screenshot described by `google/gemini-3.8-flash`). Gemini Live accepts images, but Gateway's realtime adapter rejects them: an image item closes the WebSocket with `1008 WebSocket transform rejected frame`.

**Studio:** `read_selection` (DOM selection, notes, and drawings anchored to elements), `read_html`, `edit_html` (literal search/replace), `write_html` (full rewrite).

Realtime tool calls arrive in the browser over the model's WebSocket, so the tools run there. Each example defines them in `_lib/tools.ts` like AI SDK tools, with a label, a zod `input`, and an `execute` typed from it (`lib/tools.ts`). The voice loop declares the session's tool definitions from those inputs, validates every call's name and arguments, and passes `execute` the example's context: the tldraw editor in v1 and the studio's actions in v2. The token route mints only a Gateway token.

## Voice loop

`lib/voice` holds the pieces, and each example assembles them in `_lib/use-voice-agent.ts`:

- `useVoiceSession`: the microphone, the connection, and the raw AI SDK handle (`realtime.messages`, `events`, `sendEvent`). Other hooks attach with `subscribe` and `handleToolCalls`.
- `useToolCalls`: validates and runs tool calls, deduplicates call IDs, and reports activity.
- `useResponses`: thinking/writing state, the stall notice, failure errors, and one retry when a tool call's JSON arrives cut off.
- `voiceState`: the one-word status next to the controls.

A session's state is per instance, but the microphone, the speakers, and Gateway's session limit are shared. Create one session per page and pass it down; two instances mean two agents listening to the same microphone.

Gemini transcribes both sides of the conversation (`inputAudioTranscription` and `outputAudioTranscription`). The AI SDK turns the transcripts and tool calls into `messages`, which the transcript toggle next to the voice controls shows as a small chat.

## Extended thinking

The brain toggle next to the voice controls picks the model for the next session: `google/gemini-3.8-live-extended-thinking` with `thinkingLevel: 'low'` (the default), or `google/gemini-3.8-live`. The token route mints for the chosen model (`?thinking=on|off`), and the session config only carries `thinkingConfig` for the thinking model, since Gateway closes the connection when the other model gets one. The choice is fixed while connected and kept in a cookie.

With thinking on, a turn can end while the model keeps reasoning: Gemini reports `interactionStatus: IN_PROGRESS`, goes quiet, then answers and reports `IDLE`. `useResponses` shows Thinking until then.

## Agent auth

A tool call runs in the user's browser, with the user's cookie, so by itself the API can't tell the agent from the user. The API is the security boundary, not the model or the session: the browser declares the session's tools, and anything in the page can steer the model.

v2 makes agent calls explicit. Starting voice issues a session grant (`_server/grants.ts`): an opaque token in Redis, scoped to one design and to `edit_html` and `write_html`, that expires with Gateway's 25-minute session limit. Agent writes go to `/v2/api/agent/*` with `Authorization: Bearer <grant>` and the tool call ID. They also need the owner cookie that issued the grant, so a leaked grant alone can't edit anything. Ending voice or switching designs revokes the grant. User actions, such as notes and undo, use the cookie alone.

Every agent write keeps the previous HTML, up to 50 versions, and **Undo agent edit** in the header restores it. That keeps prompt injection recoverable: text in the page that talks the model into rewriting it can be undone.

## Storage

Boards and designs live at their URL. v1 switches boards client-side and keeps the URL in sync with `history.pushState`, so tldraw stays mounted; v2 opens designs with links and creates them with a server action, both of which work before hydration. Preview iframes remount for each new document: changing an iframe's `srcDoc` navigates it, and every navigation would add a browser history entry.

Canvas edits are undoable through tldraw. The canvas saves the whole tldraw snapshot to Redis shortly after each change; the page loads it in a Server Component, so the sidebar, header, and saved sidebar width render before tldraw loads and nothing shifts. Studio designs are one Redis hash each, with separate `html` and `annotations` fields, so a saved note never overwrites a concurrent page edit. Each edit re-adds missing `data-margin-id` attributes so annotations stay attached. Each example scopes its data to the browser with its own `HttpOnly` owner cookie; this is a demo, not an account system.

Websites render in `sandbox="allow-scripts"` iframes, with a CSP that blocks network access and only allows this origin's scripts.

## Deploy

Import the directory as the project root. Set `AI_GATEWAY_API_KEY` and the Redis variables in the project environment.

- **tldraw license.** tldraw 5 needs a license on production domains: set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`.
- **Deployment Protection.** Keep previews behind it. The token and inspection routes spend Gateway credits without rate limits, and the origin checks are not authentication.

## Verify

```sh
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test
```

Browser tests drive the real editor, preview bridge, and microphone pipeline against a simulated Gateway WebSocket and mocked studio APIs. They start their own dev server on port 3100 (`NEXT_DIST_DIR=.next-test`, so it runs beside yours) with `MARGIN_STORE=memory`, so they never write to Redis.
