import { z } from 'zod'

/** What every tool's `execute` gets besides its input and the example's context. */
export type ToolCall = { callId: string; signal: AbortSignal }

/**
 * A tool the voice model can call, like an AI SDK tool with `execute`.
 * Realtime tool calls arrive in the browser, so `execute` runs there.
 */
export type Tool<Context> = {
  description: string
  /** Shown while the tool runs. */
  label: string
  input: z.ZodType
  // Each tool's input type is checked where it's defined; see `toolkit`.
  execute: (args: { input: any } & ToolCall & Context) => unknown
}

export type Tools<Context> = Record<string, Tool<Context>>

/**
 * Returns a `tool()` helper for one example: `execute` is typed from the
 * tool's zod input and receives that example's context.
 */
export function toolkit<Context>() {
  return <Input>(tool: {
    description: string
    label: string
    input: z.ZodType<Input>
    execute: (args: { input: Input } & ToolCall & Context) => unknown
  }): Tool<Context> => tool
}

/** Realtime session tool definitions, generated from the tools' zod inputs. */
export function realtimeToolDefinitions<Context>({
  tools,
}: {
  tools: Tools<Context>
}) {
  return Object.entries(tools).map(([name, tool]) => {
    const { $schema: _, ...parameters } = z.toJSONSchema(tool.input, {
      target: 'draft-7',
      io: 'input',
    })
    return {
      type: 'function' as const,
      name,
      description: tool.description,
      parameters,
    }
  })
}

/**
 * Validates a tool call from the model and runs it. The model can send any
 * name and arguments, so both are checked; errors go back to the model.
 */
export async function runTool<Context>({
  tools,
  name,
  args,
  call,
  context,
}: {
  tools: Tools<Context>
  name: string
  args: unknown
  call: ToolCall
  context: Context
}) {
  if (!Object.hasOwn(tools, name)) throw new Error(`Unknown tool: ${name}`)
  const tool = tools[name]
  const input = tool.input.safeParse(args)
  if (!input.success)
    throw new Error(
      `Invalid ${name} arguments: ${z.prettifyError(input.error)}`,
    )
  return tool.execute({ input: input.data, ...call, ...context })
}
