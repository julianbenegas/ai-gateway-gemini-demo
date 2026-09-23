import { checkOrigin } from '@/lib/server'
import { annotationSchema } from '@/lib/v2/tools'
import {
  removeAnnotation,
  saveAnnotation,
  workspaceFailure,
} from '@/lib/v2/workspace'
import { z } from 'zod'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    return Response.json(
      await saveAnnotation(
        request,
        annotationSchema.parse(await request.json()),
      ),
    )
  } catch (error) {
    return workspaceFailure(error)
  }
}

export async function DELETE(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    return Response.json(
      await removeAnnotation(
        request,
        z.object({ id: z.string() }).parse(await request.json()).id,
      ),
    )
  } catch (error) {
    return workspaceFailure(error)
  }
}
