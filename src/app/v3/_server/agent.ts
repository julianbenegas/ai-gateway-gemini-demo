import 'server-only'
import type { Sandbox } from '@vercel/sandbox'
import { gateway, tool, wrapLanguageModel } from 'ai'
import { handlerContext } from 'experimental-a2/ai'
import { createAgentServer } from 'experimental-a2/ai/server'
import type { A2Store } from 'experimental-a2/server'
import { memory } from 'experimental-a2/store-memory'
import { vercelQueues } from 'experimental-a2/scheduler-vercel'
import { redisHttp } from 'experimental-a2/store-redis-http'
import { z } from 'zod'
import { CODING_MODEL, type CodingThinkingLevel } from '@/lib/models'
import { type AppMessage, appAgent } from '../_lib/agent'
import {
  bash,
  desktop,
  exposePort,
  pointAt,
  screenshot,
  xdotool,
} from './desktop'

const INSTRUCTIONS = `You are a coding agent with your own Linux computer: an Ubuntu desktop with Google Chrome, and a shell. The user watches the screen next to this chat, and the screen's size follows their window, so it can change between screenshots.
- Use bash for anything a command can do, like code, files, and checks; it is instant. The desktop has no terminal app. Work in /vercel/sandbox. Node 22, npm, pnpm, Python 3, and git are installed. Start dev servers in the background (for example \`nohup pnpm dev > dev.log 2>&1 &\`) and check them with curl.
- Use the screen to see and use apps: screenshot, click, type, key, and scroll. Coordinates are on a 1000×1000 grid over the screenshot: x from 0 (left) to 999 (right), y from 0 (top) to 999 (bottom).
- Every screen action returns a new screenshot. Use the latest one for coordinates, look at it before the next action, and don't claim something happened unless you saw it.
- To open a page in Chrome, press ctrl+l, type the URL, and press Return.
- Next to this chat, the user sees two tabs: App, which opens first and shows the web app you run on your computer, full size, and Computer, your live desktop. To show the user your app, start its server yourself with bash, in the background, then call show_preview with its port; it doesn't start anything, and until you call it the App tab is empty. Call show_computer when they should watch you work on the desktop. Keep using Chrome on the desktop to check your own work.
- Previews are served on the public host show_preview returns. Dev servers that check origins need that host allowed, then a restart: for Next.js, add allowedDevOrigins: ['*.vercel.run'] to next.config; for Vite, set server.allowedHosts: ['.vercel.run']. Without it the page loads but doesn't update live.
- Keep replies short and in plain text, without Markdown: what you did, and what you saw.`

// Added for a request that voice mode delegated.
const DELEGATED = `This request comes from voice mode. The user is talking out loud with a voice assistant, which wrote this task for you from the conversation, so its wording is the assistant's, not the user's. The assistant waits for your reply and tells the user the gist in a sentence or two. Do the work, then reply with the outcome first: what now works or what you found, plus anything the user must decide. If the task is unclear, reply with the question instead of guessing.`

// Next.js may load this module more than once in development, as the page
// and the events route, so the in-memory store lives on globalThis.
const shared = globalThis as typeof globalThis & {
  marginV3Store?: A2Store
}

function createStore(): A2Store | undefined {
  if (process.env.MARGIN_STORE === 'memory')
    return (shared.marginV3Store ??= memory())
  const { KV_REST_API_URL: url, KV_REST_API_TOKEN: token } = process.env
  // Without Redis, a2 keeps development logs in SQLite under .a2/.
  return url && token
    ? redisHttp({ url, token, keyPrefix: 'margin:v3:a2' })
    : undefined
}

const point = {
  x: z.number().int().min(0).max(999).describe('0 (left) to 999 (right)'),
  y: z.number().int().min(0).max(999).describe('0 (top) to 999 (bottom)'),
}

/** The app's desktop, from the a2 session running this tool. */
const currentDesktop = () =>
  desktop({ appId: handlerContext(appAgent).session.id })

type Screen = { screenshot: string }

/** Shows the model the screenshot instead of its base64. */
const seeScreen = ({ output }: { output: Screen }) => ({
  type: 'content' as const,
  value: [
    { type: 'text' as const, text: 'The screen now:' },
    {
      type: 'file' as const,
      mediaType: 'image/jpeg',
      data: { type: 'data' as const, data: output.screenshot },
    },
  ],
})

/** Runs a screen action, lets the screen settle, and captures it. */
function screenTool<Input extends Record<string, unknown>>({
  description,
  inputSchema,
  act,
}: {
  description: string
  inputSchema: z.ZodType<Input>
  act: (input: Input & { sandbox: Sandbox }) => Promise<void>
}) {
  return tool({
    description,
    inputSchema,
    execute: async (input: Input): Promise<Screen> => {
      const sandbox = await currentDesktop()
      await act({ ...input, sandbox })
      await new Promise((resolve) => setTimeout(resolve, 700))
      return { screenshot: await screenshot({ sandbox }) }
    },
    toModelOutput: seeScreen,
  })
}

const tools = {
  screenshot: tool({
    description: 'See the screen.',
    inputSchema: z.object({}),
    execute: async (): Promise<Screen> => ({
      screenshot: await screenshot({ sandbox: await currentDesktop() }),
    }),
    toModelOutput: seeScreen,
  }),
  click: screenTool({
    description: 'Click at a point on the screen.',
    inputSchema: z.object({
      ...point,
      button: z.enum(['left', 'right', 'middle']).default('left'),
      clicks: z.number().int().min(1).max(3).default(1),
    }),
    act: ({ sandbox, x, y, button, clicks }) =>
      pointAt({
        sandbox,
        x,
        y,
        after: [
          'click',
          '--repeat',
          String(clicks),
          { left: '1', middle: '2', right: '3' }[button],
        ],
      }),
  }),
  type: screenTool({
    description: 'Type text where the keyboard focus is.',
    inputSchema: z.object({ text: z.string().min(1) }),
    act: ({ sandbox, text }) =>
      xdotool({ sandbox, args: ['type', '--delay', '12', '--', text] }),
  }),
  key: screenTool({
    description:
      'Press keys, as xdotool key names: "Return", "ctrl+l", "ctrl+shift+t", "Escape".',
    inputSchema: z.object({ keys: z.string().min(1) }),
    act: ({ sandbox, keys }) =>
      xdotool({ sandbox, args: ['key', '--', ...keys.split(/\s+/)] }),
  }),
  scroll: screenTool({
    description: 'Scroll at a point on the screen.',
    inputSchema: z.object({
      ...point,
      direction: z.enum(['up', 'down', 'left', 'right']),
      amount: z.number().int().min(1).max(20).default(5),
    }),
    act: ({ sandbox, x, y, direction, amount }) =>
      pointAt({
        sandbox,
        x,
        y,
        after: [
          'click',
          '--repeat',
          String(amount),
          { up: '4', down: '5', left: '6', right: '7' }[direction],
        ],
      }),
  }),
  show_preview: tool({
    description:
      "Show the user a web server that runs on your computer, full size in their App tab. Start the server with bash first; this doesn't start anything. Returns the public URL and host, or an error if nothing answers on the port.",
    inputSchema: z.object({
      port: z.number().int().min(1).max(65535),
      path: z.string().startsWith('/').default('/'),
    }),
    execute: async ({ port, path }) =>
      exposePort({ sandbox: await currentDesktop(), port, path }),
  }),
  show_computer: tool({
    description:
      "Switch the user's view back to your computer's screen, so they can watch you work.",
    inputSchema: z.object({}),
    execute: async () => ({ ok: true }),
  }),
  bash: tool({
    description:
      'Run a shell command in /vercel/sandbox. Files persist between commands. Background long-running servers.',
    inputSchema: z.object({
      command: z.string().min(1),
      // Within one function invocation; see maxDuration on the routes.
      timeoutSeconds: z.number().int().min(1).max(240).default(120),
    }),
    execute: async ({ command, timeoutSeconds }) =>
      bash({
        sandbox: await currentDesktop(),
        command,
        timeoutSeconds,
        signal: handlerContext(appAgent).signal,
      }),
  }),
}

const store = createStore()

/**
 * Wakes agent work in a fresh invocation when the one that started it ends,
 * and recovers from crashed ones. Locally, @vercel/queue sends to the real
 * service with the OIDC token and delivers in-process.
 */
export const scheduler = vercelQueues({ topic: 'margin-v3' })

/** The model with the thinking level the request asked for. */
const codingModel = (thinkingLevel: CodingThinkingLevel) =>
  wrapLanguageModel({
    model: gateway(CODING_MODEL),
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          google: {
            ...params.providerOptions?.google,
            thinkingConfig: { thinkingLevel },
          },
        },
      }),
    },
  })

// The request that started this turn is the latest user message.
const request = (messages: AppMessage[]) =>
  messages.findLast((message) => message.role === 'user')

export const agentServer = createAgentServer({
  ...(store && { store }),
  scheduler,
  agent: appAgent,
  model: ({ messages }) =>
    codingModel(request(messages)?.metadata?.thinking ?? 'medium'),
  instructions: ({ messages }) =>
    request(messages)?.metadata?.via === 'voice'
      ? `${INSTRUCTIONS}\n\n${DELEGATED}`
      : INSTRUCTIONS,
  // Explicit, since the wrapped model isn't a plain Gateway id.
  compaction: { thresholdTokens: 200_000 },
  tools,
  maxSteps: 80,
})
