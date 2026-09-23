import { parentPort, workerData } from 'node:worker_threads'
import { Bash } from 'just-bash'
import { restoreFiles, ROOT, snapshotFiles } from '../src/lib/v2/filesystem.mjs'

try {
  const fs = await restoreFiles(workerData.data)
  await fs.mkdir('/tmp', { recursive: true })
  const bash = new Bash({
    fs,
    cwd: ROOT,
    javascript: true,
    executionLimits: { maxExecutionTimeMs: 120_000 },
  })
  const { stdout, stderr, exitCode } = await bash.exec(workerData.command, {
    rawScript: true,
  })
  parentPort.postMessage({
    stdout,
    stderr,
    exitCode,
    data: await snapshotFiles(fs),
  })
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? error.message : String(error),
  })
}
