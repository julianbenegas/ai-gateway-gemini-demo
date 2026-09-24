import 'server-only'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { apiDefaults, HttpError } from '@/lib/api'
import { thinkingLevels } from '@/lib/models'
import { realtimeToken } from '@/lib/realtime'
import {
  annotationSchema,
  deleteFileInput,
  editFileInput,
  type ServerTool,
  writeFileInput,
} from '../_lib/tools'
import { owner, requireOwner } from './auth'
import { authorizeAgent, issueGrant, revokeGrant } from './grants'
import { deletePreview, showPreview } from './preview'
import {
  createDesign,
  deleteDesign,
  duplicateDesign,
  editDesign,
  type FileEdit,
  listDesigns,
  readDesign,
  removeAnnotation,
  saveAnnotation,
  renameDesign,
  undoAgentEdit,
} from './store'

const design = z.object({ id: z.uuid() })
const agentHeaders = z.object({
  authorization: z.string().optional(),
  'x-tool-call-id': z.string().min(1),
})

/** Runs an agent tool on the design its session grant was issued for. */
async function agentEdit({
  tool,
  headers,
  edit,
}: {
  tool: ServerTool
  headers: z.infer<typeof agentHeaders>
  edit: FileEdit
}) {
  const grant = await authorizeAgent({
    authorization: headers.authorization,
    tool,
    owner: await owner.read(),
  })
  return editDesign({
    ref: { owner: grant.owner, id: grant.designId },
    edit,
    tool,
    callId: headers['x-tool-call-id'],
  })
}

export const api = new Elysia({ prefix: '/v2/api' })
  .use(apiDefaults)
  // The user, identified by the owner cookie.
  .get('/designs', async () => listDesigns({ owner: await owner.read() }))
  .post('/designs', async () => createDesign({ owner: await owner.ensure() }))
  .get(
    '/designs/:id',
    async ({ params }) =>
      readDesign({ owner: await requireOwner(), id: params.id }),
    { params: design },
  )
  .patch(
    '/designs/:id',
    async ({ params, body }) =>
      renameDesign({ owner: await requireOwner(), id: params.id, ...body }),
    {
      params: design,
      body: z.object({ name: z.string().trim().min(1).max(80) }),
    },
  )
  .delete(
    '/designs/:id',
    async ({ params }) => {
      const deleted = await deleteDesign({
        owner: await requireOwner(),
        id: params.id,
      })
      await deletePreview({ designId: params.id })
      return deleted
    },
    { params: design },
  )
  .post(
    '/designs/:id/duplicate',
    async ({ params }) =>
      duplicateDesign({ owner: await requireOwner(), id: params.id }),
    { params: design },
  )
  // Brings the design's preview up to date, booting its sandbox if needed.
  .post(
    '/designs/:id/preview',
    async ({ params }) => {
      const site = await readDesign({
        owner: await requireOwner(),
        id: params.id,
      })
      return {
        url: await showPreview({ designId: site.id, files: site.files }),
      }
    },
    { params: design },
  )
  .post(
    '/designs/:id/undo',
    async ({ params }) =>
      undoAgentEdit({ owner: await requireOwner(), id: params.id }),
    { params: design },
  )
  .post(
    '/designs/:id/annotations',
    async ({ params, body }) =>
      saveAnnotation({
        ref: { owner: await requireOwner(), id: params.id },
        annotation: body,
      }),
    { params: design, body: annotationSchema },
  )
  .delete(
    '/designs/:id/annotations/:annotationId',
    async ({ params }) =>
      removeAnnotation({
        ref: { owner: await requireOwner(), id: params.id },
        annotationId: params.annotationId,
      }),
    { params: design.extend({ annotationId: z.string() }) },
  )
  // Starting voice: a Gateway token for the session, and a grant for its tools.
  .post(
    '/realtime',
    async ({ query }) => {
      if (!(await listDesigns({ owner: await owner.read() })).length)
        throw new HttpError({
          message: 'Create a design to start voice.',
          status: 401,
        })
      return realtimeToken({ thinking: query.thinking !== 'none' })
    },
    { query: z.object({ thinking: z.enum(thinkingLevels).default('low') }) },
  )
  .post(
    '/grants',
    async ({ body }) => {
      const current = await requireOwner()
      await readDesign({ owner: current, id: body.designId })
      return issueGrant({ owner: current, designId: body.designId })
    },
    { body: z.object({ designId: z.uuid() }) },
  )
  // The agent, identified by its session grant.
  .post(
    '/agent/edit_file',
    async ({ headers, body }) =>
      agentEdit({ tool: 'edit_file', headers, edit: body }),
    { headers: agentHeaders, body: editFileInput },
  )
  .post(
    '/agent/write_file',
    async ({ headers, body }) =>
      agentEdit({ tool: 'write_file', headers, edit: body }),
    { headers: agentHeaders, body: writeFileInput },
  )
  .post(
    '/agent/delete_file',
    async ({ headers, body }) =>
      agentEdit({
        tool: 'delete_file',
        headers,
        edit: { path: body.path, delete: true },
      }),
    { headers: agentHeaders, body: deleteFileInput },
  )
  .delete(
    '/agent/grant',
    async ({ headers }) => {
      await revokeGrant({ authorization: headers.authorization })
      return { ok: true }
    },
    { headers: agentHeaders.pick({ authorization: true }) },
  )

export type Api = typeof api
