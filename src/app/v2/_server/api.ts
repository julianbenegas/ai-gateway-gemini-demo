import 'server-only'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { apiDefaults, HttpError } from '@/lib/api'
import { realtimeToken } from '@/lib/realtime'
import { annotationSchema, editSchema, siteTools } from '../_lib/tools'
import {
  createDesign,
  editDesign,
  listDesigns,
  readDesign,
  removeAnnotation,
  saveAnnotation,
  starterSite,
} from './store'

const design = z.object({ id: z.uuid() })

export const api = new Elysia({ prefix: '/v2/api' })
  .use(apiDefaults)
  .get('/starter', async () => starterSite())
  .get('/designs', async () => listDesigns())
  .post('/designs', async () => createDesign())
  .get('/designs/:id', async ({ params }) => readDesign(params.id), {
    params: design,
  })
  .patch(
    '/designs/:id',
    async ({ params, body }) => editDesign(params.id, body),
    {
      params: design,
      body: editSchema,
    },
  )
  .post(
    '/designs/:id/annotations',
    async ({ params, body }) => saveAnnotation(params.id, body),
    { params: design, body: annotationSchema },
  )
  .delete(
    '/designs/:id/annotations/:annotationId',
    async ({ params }) => removeAnnotation(params.id, params.annotationId),
    { params: design.extend({ annotationId: z.string() }) },
  )
  .post('/realtime', async () => {
    if (!(await listDesigns()).length)
      throw new HttpError('Create a design to start voice.', 401)
    return realtimeToken(siteTools)
  })

export type Api = typeof api
