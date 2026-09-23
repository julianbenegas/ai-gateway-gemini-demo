import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type { WorkspaceData } from './filesystem.mjs'

type Result = {
  stdout: string
  stderr: string
  exitCode: number
  data: WorkspaceData
}

export function executeBash(
  data: WorkspaceData,
  command: string,
  signal: AbortSignal,
): Promise<Result> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(process.cwd(), 'scripts/v2-bash-worker.mjs'),
      { workerData: { data, command }, env: {}, execArgv: [] },
    )
    const timeout = setTimeout(
      () => finish(new Error('The command exceeded two minutes.')),
      120_000,
    )
    const abort = () => finish(new Error('Command cancelled.'))
    let finished = false
    function finish(error?: Error, result?: Result) {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error)
      else resolve(result!)
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', (result) =>
      finish(result.error ? new Error(result.error) : undefined, result),
    )
    worker.once('error', (error) => finish(error))
    worker.once('exit', (code) => {
      if (!finished) finish(new Error(`The command worker exited (${code}).`))
    })
  })
}
