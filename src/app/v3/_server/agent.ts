import 'server-only'
import { tool } from 'ai'
import { handlerContext } from 'experimental-a2/ai'
import { createAgentServer } from 'experimental-a2/ai/server'
import type { A2Store } from 'experimental-a2/server'
import { memory } from 'experimental-a2/store-memory'
import { vercelQueues } from 'experimental-a2/scheduler-vercel'
import { redisHttp } from 'experimental-a2/store-redis-http'
import { z } from 'zod'
import { CODING_MODEL } from '@/lib/models'
import { appAgent } from '../_lib/agent'
import { bash, desktop, SCREEN, screenshot, xdotool } from './desktop'

const INSTRUCTIONS = `You are a coding agent with your own Linux computer: an Ubuntu desktop (${SCREEN.width}×${SCREEN.height}) with Google Chrome, and a shell. The user watches the screen next to this chat.
- Use bash for anything a command can do, like code, files, and checks; it is instant. The desktop has no terminal app. Work in /vercel/sandbox. Node 22, npm, pnpm, Python 3, and git are installed. Start dev servers in the background (for example \`nohup pnpm dev > dev.log 2>&1 &\`) and check them with curl.
- Use the screen to see and use apps: screenshot, click, type, key, and scroll. Coordinates are on a 1000×1000 grid over the screenshot: x from 0 (left) to 999 (right), y from 0 (top) to 999 (bottom).
- Every screen action returns a new screenshot. Look at it before the next action, and don't claim something happened unless you saw it.
- To open a page in Chrome, press ctrl+l, type the URL, and press Return.
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
const toPixel = ({ x, y }: { x: number; y: number }) => [
  String(Math.round(((x + 0.5) / 1000) * SCREEN.width)),
  String(Math.round(((y + 0.5) / 1000) * SCREEN.height)),
]

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
  act: (input: Input) => string[][]
}) {
  return tool({
    description,
    inputSchema,
    execute: async (input: Input): Promise<Screen> => {
      const sandbox = await currentDesktop()
      for (const args of act(input)) await xdotool({ sandbox, args })
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
    act: ({ x, y, button, clicks }) => [
      ['mousemove', ...toPixel({ x, y })],
      [
        'click',
        '--repeat',
        String(clicks),
        { left: '1', middle: '2', right: '3' }[button],
      ],
    ],
  }),
  type: screenTool({
    description: 'Type text where the keyboard focus is.',
    inputSchema: z.object({ text: z.string().min(1) }),
    act: ({ text }) => [['type', '--delay', '12', '--', text]],
  }),
  key: screenTool({
    description:
      'Press keys, as xdotool key names: "Return", "ctrl+l", "ctrl+shift+t", "Escape".',
    inputSchema: z.object({ keys: z.string().min(1) }),
    act: ({ keys }) => [['key', '--', ...keys.split(/\s+/)]],
  }),
  scroll: screenTool({
    description: 'Scroll at a point on the screen.',
    inputSchema: z.object({
      ...point,
      direction: z.enum(['up', 'down', 'left', 'right']),
      amount: z.number().int().min(1).max(20).default(5),
    }),
    act: ({ x, y, direction, amount }) => [
      ['mousemove', ...toPixel({ x, y })],
      [
        'click',
        '--repeat',
        String(amount),
        { up: '4', down: '5', left: '6', right: '7' }[direction],
      ],
    ],
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
        timeoutMs: timeoutSeconds * 1000,
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

export const agentServer = createAgentServer({
  ...(store && { store }),
  scheduler,
  agent: appAgent,
  model: CODING_MODEL,
  // The request that started this turn is the latest user message.
  instructions: ({ messages }) =>
    messages.findLast((message) => message.role === 'user')?.metadata?.via ===
    'voice'
      ? `${INSTRUCTIONS}\n\n${DELEGATED}`
      : INSTRUCTIONS,
  tools,
  maxSteps: 80,
})
