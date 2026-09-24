import 'server-only'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { apiDefaults, HttpError } from '@/lib/api'
import { realtimeToken } from '@/lib/realtime'
import {
  annotationSchema,
  editHtmlInput,
  type ServerTool,
  writeHtmlInput,
} from '../_lib/tools'
import { owner, requireOwner } from './auth'
import { authorizeAgent, issueGrant, revokeGrant } from './grants'
import {
  createDesign,
  editDesign,
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
  edit: Parameters<typeof editDesign>[0]['edit']
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
      return realtimeToken({ thinking: query.thinking === 'on' })
    },
    { query: z.object({ thinking: z.enum(['on', 'off']).default('on') }) },
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
    '/agent/edit_html',
    async ({ headers, body }) =>
      agentEdit({ tool: 'edit_html', headers, edit: body }),
    { headers: agentHeaders, body: editHtmlInput },
  )
  .post(
    '/agent/write_html',
    async ({ headers, body }) =>
      agentEdit({ tool: 'write_html', headers, edit: body }),
    { headers: agentHeaders, body: writeHtmlInput },
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
