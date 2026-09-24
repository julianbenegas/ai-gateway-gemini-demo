import 'server-only'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { apiDefaults } from '@/lib/api'
import { thinkingLevels } from '@/lib/models'
import { realtimeToken } from '@/lib/realtime'
import { deleteApp, listApps, ownsApp, renameApp } from './apps'
import { owner, requireOwner } from './auth'
import { viewerUrl } from './desktop'
import { HttpError } from '@/lib/api'

const app = z.object({ id: z.uuid() })

async function requireApp({ id }: { id: string }) {
  const current = await requireOwner()
  if (!(await ownsApp({ owner: current, id })))
    throw new HttpError({
      message: 'This app could not be found.',
      status: 404,
    })
  return { owner: current, id }
}

export const api = new Elysia({ prefix: '/v3/api' })
  .use(apiDefaults)
  .get('/apps', async () => listApps({ owner: await owner.read() }))
  // A short-lived Gateway secret for voice mode, for the chosen model.
  .post(
    '/realtime',
    async ({ query }) => realtimeToken({ thinking: query.thinking !== 'none' }),
    { query: z.object({ thinking: z.enum(thinkingLevels).default('low') }) },
  )
  .patch(
    '/apps/:id',
    async ({ params, body }) =>
      renameApp({
        owner: await requireOwner(),
        id: params.id,
        name: body.name,
      }),
    { params: app, body: z.object({ name: z.string().trim().min(1).max(80) }) },
  )
  .delete(
    '/apps/:id',
    async ({ params }) =>
      deleteApp({ owner: await requireOwner(), id: params.id }),
    { params: app },
  )
  // Boots or resumes the app's desktop and returns its viewer.
  .post(
    '/apps/:id/desktop',
    async ({ params }) => ({
      url: await viewerUrl({ appId: (await requireApp(params)).id }),
    }),
    { params: app },
  )

export type Api = typeof api
