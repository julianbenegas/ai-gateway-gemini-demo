import { z } from 'zod'
import { checkOrigin } from '@/lib/server'
import {
  removeAnnotation,
  saveAnnotation,
  studioFailure,
} from '@/studio/server/store'
import { annotationSchema } from '@/studio/tools'

const forbidden = () =>
  Response.json({ error: 'Invalid request origin' }, { status: 403 })

export async function POST(request: Request) {
  if (!checkOrigin(request)) return forbidden()
  try {
    const annotation = annotationSchema.parse(await request.json())
    return Response.json(await saveAnnotation(request, annotation))
  } catch (error) {
    return studioFailure(error)
  }
}

export async function DELETE(request: Request) {
  if (!checkOrigin(request)) return forbidden()
  try {
    const { id } = z.object({ id: z.string() }).parse(await request.json())
    return Response.json(await removeAnnotation(request, id))
  } catch (error) {
    return studioFailure(error)
  }
}
