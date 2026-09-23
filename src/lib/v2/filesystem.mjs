import { InMemoryFs } from 'just-bash'
import { isDeepStrictEqual } from 'node:util'

export const ROOT = '/vercel/margin'
export const HTML = `${ROOT}/index.html`
export const NOTES = `${ROOT}/annotations.json`

export async function restoreFiles(data) {
  const fs = new InMemoryFs()
  await fs.mkdir(ROOT, { recursive: true })
  const entries = Object.entries(data.files).sort(
    ([a], [b]) => a.length - b.length,
  )
  for (const [path, entry] of entries) {
    if (entry.type === 'symlink') continue
    if (entry.type === 'directory') await fs.mkdir(path, { recursive: true })
    else {
      await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
      await fs.writeFile(
        path,
        entry.encoding === 'base64'
          ? Buffer.from(entry.content, 'base64')
          : entry.content,
      )
    }
    if (entry.mode !== undefined) await fs.chmod(path, entry.mode)
  }
  for (const [path, entry] of entries) {
    if (entry.type !== 'symlink') continue
    await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    await fs.symlink(entry.target, path)
  }
  return fs
}

export async function snapshotFiles(fs) {
  const files = {}
  for (const path of fs.getAllPaths()) {
    if (path !== ROOT && !path.startsWith(`${ROOT}/`)) continue
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink)
      files[path] = { type: 'symlink', target: await fs.readlink(path) }
    else if (stat.isDirectory)
      files[path] = { type: 'directory', mode: stat.mode }
    else {
      const bytes = Buffer.from(await fs.readFileBuffer(path))
      const text = bytes.toString('utf8')
      files[path] = Buffer.from(text).equals(bytes)
        ? { type: 'file', content: text, mode: stat.mode }
        : {
            type: 'file',
            content: bytes.toString('base64'),
            encoding: 'base64',
            mode: stat.mode,
          }
    }
  }
  return { files }
}

export function changedFiles(before, after) {
  return {
    writes: Object.fromEntries(
      Object.entries(after.files).filter(
        ([path, entry]) => !isDeepStrictEqual(entry, before.files[path]),
      ),
    ),
    deletes: Object.keys(before.files).filter((path) => !(path in after.files)),
  }
}
