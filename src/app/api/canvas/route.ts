import { ZodError } from 'zod'
import { loadBoard, saveBoard } from '@/canvas/server/board'
import { checkOrigin } from '@/lib/server'

export async function GET() {
  return Response.json(await loadBoard(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function PUT(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    await saveBoard(request)
    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json({ error: 'Invalid board data.' }, { status: 400 })
    console.error(
      'Board save failed:',
      error instanceof Error ? error.message : 'Unknown error',
    )
    return Response.json(
      { error: 'The board could not be saved.' },
      { status: 503 },
    )
  }
}
