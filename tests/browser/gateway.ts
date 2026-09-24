import { expect, type Page, type WebSocketRoute } from '@playwright/test'

export async function mockGateway(page: Page, endpoint = '**/v1/api/realtime') {
  let socket: WebSocketRoute
  const outputs = new Map<string, unknown>()
  const sent: Record<string, unknown>[] = []
  await page.route(endpoint, (route) =>
    route.fulfill({
      // Like the real routes: tools are declared by the browser, not here.
      json: { token: 'test-token', url: 'wss://gateway.test/realtime' },
    }),
  )
  await page.routeWebSocket('wss://gateway.test/realtime', (ws) => {
    socket = ws
    ws.onMessage((message) => {
      const event = JSON.parse(String(message))
      sent.push(event)
      if (event.type === 'session-update')
        ws.send(JSON.stringify({ type: 'session-updated', raw: {} }))
      if (
        event.type === 'conversation-item-create' &&
        event.item?.type === 'function-call-output'
      )
        outputs.set(event.item.callId, JSON.parse(event.item.output))
    })
  })
  let n = 0
  return {
    sent,
    outputs,
    send(event: Record<string, unknown>) {
      socket.send(JSON.stringify({ ...event, raw: event.raw ?? {} }))
    },
    async call(name: string, args: unknown, id = `call-${++n}`) {
      await expect.poll(() => Boolean(socket)).toBe(true)
      socket!.send(
        JSON.stringify({
          type: 'function-call-arguments-done',
          responseId: `response-${n}`,
          itemId: `item-${id}`,
          callId: id,
          name,
          arguments: JSON.stringify(args),
          raw: {},
        }),
      )
      await expect.poll(() => outputs.has(id), { timeout: 20000 }).toBe(true)
      return outputs.get(id) as Record<string, any>
    },
  }
}
