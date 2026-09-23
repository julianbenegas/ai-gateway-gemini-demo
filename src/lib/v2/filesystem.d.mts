import type { IFileSystem, InMemoryFs } from 'just-bash'

export const ROOT: string
export const HTML: string
export const NOTES: string
export type StoredEntry =
  | { type: 'file'; content: string; encoding?: 'base64'; mode?: number }
  | { type: 'directory'; mode?: number }
  | { type: 'symlink'; target: string }
export type WorkspaceData = { files: Record<string, StoredEntry> }
export function restoreFiles(data: WorkspaceData): Promise<InMemoryFs>
export function snapshotFiles(fs: IFileSystem): Promise<WorkspaceData>
export function changedFiles(
  before: WorkspaceData,
  after: WorkspaceData,
): { writes: WorkspaceData['files']; deletes: string[] }
