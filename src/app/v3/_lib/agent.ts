import type { UIMessage } from 'ai'
import { agent } from 'experimental-a2/ai'

/** A task from voice mode carries `via: 'voice'`. */
export type AppMessage = UIMessage<{ via?: 'voice' }>

/** The coding agent's contract, shared by the server and the browser. */
export const appAgent = agent<AppMessage>({ name: 'margin-v3-app' })

export const toolLabels: Record<string, string> = {
  screenshot: 'Looking at the screen',
  click: 'Clicking',
  type: 'Typing',
  key: 'Pressing keys',
  scroll: 'Scrolling',
  bash: 'Running a command',
}
