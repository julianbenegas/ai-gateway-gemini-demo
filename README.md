# Margin

A voice-first website designer. You talk, point, and sketch; an agent built on Gemini 3.8 Live edits the design.

It was built to explore [Gemini 3.8 Live on Vercel AI Gateway](https://vercel.com/changelog/gemini-3-8-live-models-now-available-on-ai-gateway), and to try out what a voice-first app feels like when the agent works on something you can see and point at.

There are three takes on the idea:

- **`/v1`** is a tldraw canvas where websites are shapes. You point at the board while you talk, and the agent edits websites and arranges things on the canvas.
- **`/v2`** is a single website. You select elements, draw on them, and leave notes while you talk, and the agent edits the page.
- **`/v3`** pairs the voice model with a stronger one. You chat with a Gemini 3.8 Flash coding agent that has its own computer, a [Vercel Sandbox](https://vercel.com/docs/sandbox) desktop you watch beside the chat. Or you turn on voice mode and talk to Gemini Live, which hands the work to that agent.

All three can use Gemini 3.8 Live or Gemini 3.8 Live Extended Thinking, and show a transcript you can also type into.

## Run it

```sh
pnpm install
pnpm dev
```

Set `AI_GATEWAY_API_KEY` to an AI Gateway API key. To keep boards and designs across restarts, also connect Upstash Redis (`KV_REST_API_URL` and `KV_REST_API_TOKEN`); without it they live in memory during development.

`/v3` also needs Vercel Sandbox. Link a Vercel project (`vercel link && vercel env pull`), build the desktop snapshot once, and set `MARGIN_V3_SNAPSHOT_ID` to the id it prints:

```sh
node --env-file=.env.local scripts/v3-desktop-snapshot.mjs
```

The desktop follows [vercel-labs/ai-sdk-computer-use](https://github.com/vercel-labs/ai-sdk-computer-use), and the agent's conversation is a durable [a2](https://www.a2.dev) session.

The canvas uses the [tldraw SDK](https://tldraw.dev), which needs a license key on production domains.
