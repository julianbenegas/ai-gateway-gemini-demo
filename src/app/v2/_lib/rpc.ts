import type { z } from 'zod'
import { rpc, unwrap } from '@/lib/rpc'
import type { ToolCall } from '@/lib/tools'
import type { Api } from '../_server/api'
import type { editHtmlInput, writeHtmlInput } from './tools'
import type { SiteAnnotation } from './types'

const api = rpc<Api>().v2.api

const design = (id: string | null) => {
  if (!id) throw new Error('Create a design to save changes.')
  return api.designs({ id })
}

/** The user's calls, authorized by the owner cookie. */
export const studioApi = {
  designs: () => unwrap(api.designs.get()),
  site: ({ id }: { id: string | null }) =>
    unwrap(id ? api.designs({ id }).get() : api.starter.get()),
  createDesign: () => unwrap(api.designs.post()),
  undoAgentEdit: ({ id }: { id: string | null }) =>
    unwrap(design(id).undo.post()),
  saveAnnotation: ({
    id,
    annotation,
  }: {
    id: string | null
    annotation: SiteAnnotation
  }) => unwrap(design(id).annotations.post(annotation)),
  deleteAnnotation: ({
    id,
    annotationId,
  }: {
    id: string | null
    annotationId: string
  }) => unwrap(design(id).annotations({ annotationId }).delete()),
  issueGrant: ({ designId }: { designId: string }) =>
    unwrap(api.grants.post({ designId })),
}

const agentHeaders = ({
  grant,
  callId,
}: {
  grant: string
  callId: string
}) => ({
  authorization: `Bearer ${grant}`,
  'x-tool-call-id': callId,
})

/** The agent's calls, authorized by the voice session's grant. */
export const agentApi = {
  editHtml: ({
    grant,
    input,
    callId,
    signal,
  }: { grant: string; input: z.infer<typeof editHtmlInput> } & ToolCall) =>
    unwrap(
      api.agent.edit_html.post(input, {
        headers: agentHeaders({ grant, callId }),
        fetch: { signal },
      }),
    ),
  writeHtml: ({
    grant,
    input,
    callId,
    signal,
  }: { grant: string; input: z.infer<typeof writeHtmlInput> } & ToolCall) =>
    unwrap(
      api.agent.write_html.post(input, {
        headers: agentHeaders({ grant, callId }),
        fetch: { signal },
      }),
    ),
  revoke: ({ grant }: { grant: string }) =>
    unwrap(
      api.agent.grant.delete(undefined, {
        headers: { authorization: `Bearer ${grant}` },
      }),
    ),
}
