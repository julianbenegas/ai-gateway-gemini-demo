import { test, expect, type Page, type WebSocketRoute } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('API origin checks accept the browser host and reject other origins', async ({
  request,
}) => {
  const rejected = await request.post('/api/realtime', {
    headers: { Origin: 'https://another.example' },
  })
  expect(rejected.status()).toBe(403)
  const accepted = await request.post('/api/inspect', {
    headers: { Origin: 'http://localhost:3000' },
    data: {},
  })
  expect(accepted.status()).toBe(400)
  expect(await accepted.json()).toEqual({ error: 'Invalid inspection request' })
})

async function openWorkspace(page: Page) {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: 'Start live session', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Good spaces.')
}

async function mockGateway(page: Page) {
  let socket: WebSocketRoute
  const outputs = new Map<string, unknown>()
  const sent: Record<string, unknown>[] = []
  await page.route('**/api/realtime', (route) =>
    route.fulfill({
      json: {
        token: 'test-token',
        url: 'wss://gateway.test/realtime',
        tools: [],
      },
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

async function connectText(page: Page) {
  await page
    .getByRole('textbox', { name: 'Message your design partner' })
    .fill('Let’s work on this design.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'End session', exact: true }),
  ).toBeVisible()
}

test('HTML editing, responsive copies, and separate boards survive reload', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Website HTML' })
  await source.fill(
    (await source.inputValue()).replace('Good spaces.', 'Thoughtful spaces.'),
  )
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Thoughtful spaces.')
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect(page.locator('.website-list button')).toHaveCount(2)
  await expect(page.locator('.website-list')).toContainText('390 × 760')
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name' }).fill('Coffee ideas')
  await page.getByRole('textbox', { name: 'Board name' }).press('Enter')
  await expect(page.locator('.website-list button')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add website', exact: true }).click()
  await expect(page.locator('.website-list button')).toHaveCount(1)
  await page.getByRole('button', { name: 'First ideas', exact: true }).click()
  await expect(page.locator('.website-list button')).toHaveCount(2)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('TLDRAW_DOCUMENT_v2margin-board-v1')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const records = db
                .transaction('records')
                .objectStore('records')
                .getAll()
              records.onsuccess = () => {
                resolve(
                  records.result.some(
                    (record) =>
                      record.typeName === 'page' &&
                      record.name === 'Coffee ideas',
                  ),
                )
                db.close()
              }
              records.onerror = () => {
                reject(records.error)
                db.close()
              }
            }
          }),
      ),
    )
    .toBe(true)
  await page.reload()
  await expect(page.locator('.website-list button')).toHaveCount(2)
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Thoughtful spaces.')
  await expect(
    page.getByRole('button', { name: 'Coffee ideas', exact: true }),
  ).toBeVisible()
})

test('agent edits enforce fresh HTML, roll back failed batches, and reject the wrong board', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectText(page)
  const board = await gateway.call('read_board', {})
  const shapes = await gateway.call('read_shapes', { ids: ['shape:forma'] })
  const shape = shapes[0]
  const update = {
    op: 'update',
    shape: {
      id: shape.id,
      type: 'website',
      props: {
        html: shape.props.html.replace('Good spaces.', 'Made by the agent.'),
      },
    },
    expectedContentHash: shape.contentHash,
  }
  expect(
    (
      await gateway.call('apply_actions', {
        pageId: board.pageId,
        actions: [update],
      })
    ).ok,
  ).toBe(true)
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Made by the agent.')
  expect(
    (
      await gateway.call('apply_actions', {
        pageId: board.pageId,
        actions: [update],
      })
    ).error,
  ).toContain('HTML changed')
  const failed = await gateway.call('apply_actions', {
    pageId: board.pageId,
    actions: [
      {
        op: 'create',
        shape: {
          type: 'website',
          id: 'shape:rollback',
          x: 900,
          y: 900,
          props: { title: 'Must roll back' },
        },
      },
      { op: 'delete', ids: ['shape:missing'] },
    ],
  })
  expect(failed.error).toContain('missing')
  const after = await gateway.call('read_board', {})
  expect(after.shapes.some((shape: any) => shape.id === 'shape:rollback')).toBe(
    false,
  )
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  expect(
    (
      await gateway.call('apply_actions', {
        pageId: board.pageId,
        actions: [update],
      })
    ).error,
  ).toContain('switched boards')
})

test('visual inspection includes iframe pixels and canvas annotations', async ({
  page,
}, testInfo) => {
  const gateway = await mockGateway(page)
  let capture: { image: string; warnings: string[]; context: any } | undefined
  await page.route('**/api/inspect', async (route) => {
    capture = route.request().postDataJSON()
    await route.fulfill({
      json: {
        observation:
          'The Forma website has a large green headline, with a yellow note to its right.',
      },
    })
  })
  await openWorkspace(page)
  await connectText(page)
  const websiteBounds = (await page
    .locator('iframe[title="Forma · Starting point"]')
    .boundingBox())!
  await page.getByRole('button', { name: 'Draw — D', exact: true }).click()
  const cx = websiteBounds.x + websiteBounds.width * 0.44
  const cy = websiteBounds.y + websiteBounds.height * 0.3
  await page.mouse.move(cx + 160, cy)
  await page.mouse.down()
  for (let i = 1; i <= 32; i++) {
    const angle = (i / 32) * Math.PI * 2
    await page.mouse.move(cx + Math.cos(angle) * 160, cy + Math.sin(angle) * 65)
  }
  await page.mouse.up()
  const result = await gateway.call('inspect_canvas', {
    question: 'Describe the design and its annotations.',
  })
  expect(result.observation).toContain('yellow note')
  expect(capture?.warnings).toEqual([])
  expect(capture?.image.length).toBeGreaterThan(20000)
  expect(
    capture?.context.shapes.some((shape: any) => shape.type === 'note'),
  ).toBe(true)
  expect(
    capture?.context.shapes.some((shape: any) => shape.type === 'draw'),
  ).toBe(true)
  await writeFile(
    testInfo.outputPath('captured-board.png'),
    Buffer.from(capture!.image.split(',')[1], 'base64'),
  )
})

test('microphone capture starts after readiness and stops when session ends', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    )
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await getUserMedia(options)
      ;(window as any).testStream = stream
      return stream
    }
  })
  await openWorkspace(page)
  await page
    .getByRole('button', { name: 'Start live session', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  await expect
    .poll(() =>
      gateway.sent.some((event) => event.type === 'input-audio-append'),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Start live session', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      (window as any).testStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true)
})

test('websites run scripts but cannot read the editor document', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Website HTML' })
    .fill(
      '<html><body><p id="result">Waiting</p><script>try { parent.document.body.innerHTML; result.textContent="Unsafe" } catch { result.textContent="Isolated" }</script></body></html>',
    )
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .locator('#result'),
  ).toHaveText('Isolated')
})

test('a failed Gateway connection leaves an actionable error and allows retry', async ({
  page,
}) => {
  await page.route('**/api/realtime', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'No Vercel project is linked' },
    }),
  )
  await openWorkspace(page)
  await page
    .getByRole('textbox', { name: 'Message your design partner' })
    .fill('Hello')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.locator('.error-message')).toContainText('Vercel project')
  await expect(
    page.getByRole('button', { name: 'Start live session', exact: true }),
  ).toBeEnabled()
})
