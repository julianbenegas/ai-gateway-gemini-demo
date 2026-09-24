import { test, expect, type Page } from '@playwright/test'
import { mockGateway } from './gateway'
import { readFile, writeFile } from 'node:fs/promises'

test('API origin checks accept the browser host and reject other origins', async ({
  request,
  baseURL,
}) => {
  const rejected = await request.post('/v1/api/realtime', {
    headers: { Origin: 'https://another.example' },
  })
  expect(rejected.status()).toBe(403)
  const accepted = await request.post('/v1/api/inspect', {
    headers: { Origin: new URL(baseURL!).origin },
    data: {},
  })
  expect(accepted.status()).toBe(400)
  expect(await accepted.json()).toEqual({ error: 'Invalid request data.' })
})

/** Records of the board this browser saved to the server. */
async function savedRecords(page: Page): Promise<Record<string, any>[]> {
  const { snapshot } = await (await page.request.get('/v1/api/board')).json()
  return Object.values(snapshot?.document.store ?? {})
}

async function openWorkspace(page: Page) {
  await page.goto('/v1')
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Good spaces.')
}

async function openWebsiteMenu(page: Page) {
  const box = (await page
    .locator('iframe[title="Forma · Starting point"]')
    .boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: 'right',
  })
  await expect(page.getByTestId('context-menu')).toBeVisible()
}

async function openCode(page: Page) {
  await openWebsiteMenu(page)
  await page.getByRole('menuitem', { name: 'View code', exact: true }).click()
}

async function connectVoice(page: Page) {
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
}

test('short HTML edits use literal replacements, return unmatched source, and undo together', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Select — V', exact: true }).click()
  await page.keyboard.press('Escape')
  await connectVoice(page)
  const result = await gateway.call('edit_html', {
    id: 'shape:forma',
    replacements: [
      { search: 'Good spaces.', replace: 'Great $& $1 $$.' },
      { search: '#28372f', replace: '#112233', all: true },
      { search: 'no such source', replace: 'Unused' },
      { search: '', replace: 'Unused' },
    ],
  })
  expect(result.selectedIds).toEqual([])
  expect(result.updatedIds).toEqual(['shape:forma'])
  expect(result.matches[0]).toBe(1)
  expect(result.matches[1]).toBeGreaterThan(1)
  expect(result.matches.slice(2)).toEqual([0, 0])
  expect(result.html).toContain('Great $& $1 $$.')
  expect(result.html).not.toContain('#28372f')
  expect(result.html).not.toContain('Unused')
  const heading = page
    .frameLocator('iframe[title="Forma · Starting point"]')
    .getByRole('heading')
  await expect(heading).toContainText('Great $& $1 $$.')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(heading).toContainText('Good spaces.')
  const after = await gateway.call('read_shapes', { ids: ['shape:forma'] })
  expect(after[0].props.html).toContain('#28372f')
  const missing = await gateway.call('edit_html', {
    id: 'shape:gone',
    replacements: [{ search: 'x', replace: 'y' }],
  })
  expect(missing.updatedIds).toEqual([])
  expect(missing.missingIds).toEqual(['shape:gone'])
})

test('HTML editing, native duplication, and separate boards survive reload', async ({
  page,
}) => {
  await openWorkspace(page)
  await openCode(page)
  const source = page.getByRole('textbox', { name: 'Website HTML' })
  await source.fill(
    (await source.inputValue()).replace('Good spaces.', 'Thoughtful spaces.'),
  )
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(
    page
      .locator('iframe[title="Forma · Starting point"]')
      .first()
      .contentFrame()
      .getByRole('heading'),
  ).toContainText('Thoughtful spaces.')
  await page.getByRole('button', { name: 'Select — V', exact: true }).click()
  await page.keyboard.press('ControlOrMeta+d')
  await expect(page.locator('[data-website] iframe')).toHaveCount(2)
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name' }).fill('Coffee ideas')
  await page.getByRole('textbox', { name: 'Board name' }).press('Enter')
  await expect(page.locator('[data-website] iframe')).toHaveCount(0)
  await page.locator('[data-canvas]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add website', exact: true }).click()
  await expect(page.locator('[data-website] iframe')).toHaveCount(1)
  await page.getByRole('button', { name: 'First ideas', exact: true }).click()
  await expect(page.locator('[data-website] iframe')).toHaveCount(2)
  await expect
    .poll(async () => {
      const records = await savedRecords(page)
      return (
        records.some(
          (record) =>
            record.typeName === 'page' && record.name === 'Coffee ideas',
        ) &&
        records.filter(
          (record) => record.typeName === 'shape' && record.type === 'website',
        ).length === 3
      )
    })
    .toBe(true)
  await page.reload()
  await page.getByRole('button', { name: 'First ideas', exact: true }).click()
  await expect(page.locator('[data-website] iframe')).toHaveCount(2)
  await expect(
    page
      .locator('iframe[title="Forma · Starting point"]')
      .first()
      .contentFrame()
      .getByRole('heading'),
  ).toContainText('Thoughtful spaces.')
  await expect(
    page.getByRole('button', { name: 'Coffee ideas', exact: true }),
  ).toBeVisible()
})

test('website code and HTML export live in the native context menu', async ({
  page,
}) => {
  await openWorkspace(page)
  await expect(
    page.locator(
      '.workspace-name, .website-list, .website-actions, .canvas-topbar',
    ),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Variation', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Mobile', exact: true }),
  ).toHaveCount(0)
  await openWebsiteMenu(page)
  await expect(
    page.getByRole('menuitem', { name: 'View code', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Edit', exact: true }),
  ).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page
    .getByRole('menuitem', { name: 'Export as HTML', exact: true })
    .click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('forma---starting-point.html')
  const html = await readFile((await download.path())!, 'utf8')
  expect(html).toContain('<h1>Good spaces.')
  expect(html).not.toContain('html-to-image')
  await page
    .getByTestId('canvas')
    .getByText('What if this felt a little more playful?', { exact: true })
    .click()
  await page
    .getByTestId('canvas')
    .getByText('What if this felt a little more playful?', { exact: true })
    .click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Export as HTML', exact: true }),
  ).toHaveCount(0)
})

test('a long thinking silence shows a waiting notice that clears on progress', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  await page.clock.install()
  gateway.send({
    type: 'custom',
    rawType: 'interactionStatus',
    raw: { serverContent: { interactionStatus: 'IN_PROGRESS' } },
  })
  await expect(page.locator('[data-voice-state]')).toContainText('Thinking')
  await page.clock.fastForward(50000)
  await expect(page.locator('[data-notice]')).toContainText('Still waiting')
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  gateway.send({
    type: 'custom',
    rawType: 'interactionStatus',
    raw: { serverContent: { interactionStatus: 'IDLE' } },
  })
  await expect(page.locator('[data-notice]')).toHaveCount(0)
  await expect(page.locator('[data-voice-state]')).toContainText('Listening')
})

test('the waiting notice ignores silence while a tool runs', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  // Hold the vision request, as a slow tool.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let requested = false
  await page.route('**/v1/api/inspect', async (route) => {
    requested = true
    await held
    await route.fulfill({ json: { observation: 'A website.' } })
  })
  await openWorkspace(page)
  await connectVoice(page)
  gateway.send({
    type: 'function-call-arguments-done',
    responseId: 'slow',
    itemId: 'item-slow',
    callId: 'call-slow',
    name: 'inspect_canvas',
    arguments: '{}',
  })
  await expect.poll(() => requested).toBe(true)
  await page.clock.install()
  // Gemini stays in progress while it waits on a non-blocking tool.
  gateway.send({
    type: 'custom',
    rawType: 'interactionStatus',
    raw: { serverContent: { interactionStatus: 'IN_PROGRESS' } },
  })
  await page.clock.fastForward(50000)
  await expect(page.locator('[data-notice][data-tone="error"]')).toHaveCount(0)
  release()
  await expect.poll(() => gateway.outputs.has('call-slow')).toBe(true)
  await page.clock.fastForward(50000)
  await expect(page.locator('[data-notice]')).toContainText('Still waiting')
})

test('known shapes remain editable when the visible board and selection change', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  const original = await gateway.call('read_board', {})
  const target = original.shapes.find((shape: any) => shape.type === 'website')
  const website = (await gateway.call('read_shapes', { ids: [target.id] }))[0]
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  const current = await gateway.call('read_board', {})
  expect(current.selectedIds).toEqual([])
  const result = await gateway.call('apply_actions', {
    pageId: original.pageId,
    actions: [
      {
        op: 'update',
        shape: {
          id: website.id,
          props: { html: website.props.html.replace('Good spaces.', 'Great.') },
        },
      },
    ],
  })
  expect(result.updatedIds).toEqual([website.id])
  expect(result.pageId).toBe(current.pageId)
  const records = await gateway.call('read_shapes', { ids: [website.id] })
  expect(records[0].pageId).toBe(original.pageId)
  expect(records[0].props.html).toContain('Great.')
  await page.getByRole('button', { name: 'First ideas', exact: true }).click()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Great.')
  const missing = await gateway.call('apply_actions', {
    actions: [
      { op: 'delete', ids: ['shape:gone'] },
      { op: 'select', ids: [] },
    ],
  })
  expect(missing.missingIds).toEqual(['shape:gone'])
  expect(missing.deletedIds).toEqual([])
  expect(missing.selectedIds).toEqual([])
  await expect(
    page.getByText('Something went wrong', { exact: true }),
  ).toHaveCount(0)
})

test('visual inspection includes iframe pixels and canvas annotations', async ({
  page,
}, testInfo) => {
  const gateway = await mockGateway(page)
  let capture: { image: string; warnings: string[]; context: any } | undefined
  await page.route('**/v1/api/inspect', async (route) => {
    capture = route.request().postDataJSON()
    await route.fulfill({
      json: {
        observation:
          'The Forma website has a large green headline, with a yellow note to its right.',
      },
    })
  })
  await openWorkspace(page)
  await connectVoice(page)
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

test('HTML over 60k edits and persists without selection, hashes, or a page token', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Select — V', exact: true }).click()
  await page.keyboard.press('Escape')
  await connectVoice(page)
  const board = await gateway.call('read_board', {})
  expect(board.selectedIds).toEqual([])
  const target = board.shapes.find((shape: any) => shape.type === 'website')
  expect(target.props.html).toBeUndefined()
  const website = (await gateway.call('read_shapes', { ids: [target.id] }))[0]
  expect(website.props.html).toContain('Good spaces.')
  expect(website.contentHash).toBeUndefined()
  const html = website.props.html
    .replace('Good spaces.', 'Great.')
    .replace('</head>', '<style>' + ' '.repeat(65000) + '</style></head>')
  expect(html.length).toBeGreaterThan(60000)
  const result = await gateway.call('apply_actions', {
    actions: [
      { op: 'update', shape: { id: website.id, props: { html } } },
      ...Array.from({ length: 35 }, () => ({ op: 'select', ids: [] })),
    ],
  })
  expect(result.updatedIds).toEqual([website.id])
  expect(result.selectedIds).toEqual([])
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Great.')
  await expect
    .poll(async () =>
      (await savedRecords(page)).some(
        (record) => record.id === 'shape:forma' && record.props?.html === html,
      ),
    )
    .toBe(true)
  await page.reload()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Great.')
  await expect(
    page.getByText('Something went wrong', { exact: true }),
  ).toHaveCount(0)
})

test('canvas context is retrieved on demand and never injected into voice', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  await expect
    .poll(() =>
      gateway.sent.some((event) => event.type === 'input-audio-append'),
    )
    .toBe(true)
  const injectedMessages = () =>
    gateway.sent.filter(
      (event: any) =>
        event.type === 'conversation-item-create' &&
        event.item?.type === 'text-message',
    )
  expect(injectedMessages()).toEqual([])
  const initial = await gateway.call('read_board', {})
  expect(initial.selectedWebsiteIds).toEqual(['shape:forma'])
  expect(initial.visibleShapeIds).toContain('shape:forma')
  expect(JSON.stringify(initial)).not.toContain('Good spaces.')
  const note = initial.shapes.find((shape: any) => shape.type === 'note')
  await page
    .getByTestId('canvas')
    .getByText('What if this felt a little more playful?', { exact: true })
    .click()
  expect((await gateway.call('read_board', {})).selectedIds).toEqual([note.id])
  await page.keyboard.press('Escape')
  expect((await gateway.call('read_board', {})).selectedIds).toEqual([])
  const website = (
    await gateway.call('read_shapes', { ids: ['shape:forma'] })
  )[0]
  expect(website.props.html).toContain('Good spaces.')
  await gateway.call('apply_actions', {
    actions: [
      {
        op: 'create',
        shape: {
          id: 'shape:frame-context',
          type: 'frame',
          x: -20,
          y: -20,
          props: { w: 760, h: 800, name: 'Design' },
        },
      },
      { op: 'reparent', ids: ['shape:forma'], parentId: 'shape:frame-context' },
      { op: 'select', ids: ['shape:frame-context'] },
    ],
  })
  const frame = await gateway.call('read_board', {})
  expect(frame.selectedIds).toEqual(['shape:frame-context'])
  expect(frame.selectedWebsiteIds).toEqual(['shape:forma'])
  await gateway.call('edit_html', {
    id: 'shape:forma',
    replacements: [{ search: 'Good spaces.', replace: 'Great.' }],
  })
  expect(
    (await gateway.call('read_shapes', { ids: ['shape:forma'] }))[0].props.html,
  ).toContain('Great.')
  await gateway.call('apply_actions', {
    actions: [{ op: 'delete', ids: [note.id] }],
  })
  expect(
    (await gateway.call('read_board', {})).shapes.some(
      (shape: any) => shape.id === note.id,
    ),
  ).toBe(false)
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  expect((await gateway.call('read_board', {})).shapes).toEqual([])
  await page.clock.install()
  gateway.send({ type: 'speech-started' })
  await page.clock.fastForward(1000)
  expect(injectedMessages()).toEqual([])
})

test('native validation failures roll back a batch without losing earlier edits', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await openCode(page)
  const source = page.getByRole('textbox', { name: 'Website HTML' })
  await source.fill(
    (await source.inputValue()).replace('Good spaces.', 'My own copy.'),
  )
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await connectVoice(page)
  const board = await gateway.call('read_board', {})
  const result = await gateway.call('apply_actions', {
    pageId: board.pageId,
    actions: [
      {
        op: 'update',
        shape: {
          id: 'shape:forma',
          type: 'website',
          props: { title: 'Wrong title' },
        },
      },
      {
        op: 'create',
        shape: { id: 'shape:temporary', type: 'website', x: 900, y: 900 },
      },
      {
        op: 'create',
        shape: { id: 'shape:invalid', type: 'website', props: { w: -1 } },
      },
    ],
  })
  expect(result.error).toEqual(expect.any(String))
  const after = await gateway.call('read_board', {})
  expect(after.shapes.map((shape: any) => shape.id).sort()).toEqual(
    board.shapes.map((shape: any) => shape.id).sort(),
  )
  const heading = page
    .frameLocator('iframe[title="Forma · Starting point"]')
    .getByRole('heading')
  await expect(heading).toContainText('My own copy.')
  await page.getByRole('button', { name: 'Select — V', exact: true }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(heading).toContainText('Good spaces.')
  await expect(
    page.getByText('Something went wrong', { exact: true }),
  ).toHaveCount(0)
})

test('microphone uses Gemini audio settings, mutes, resumes, and stops on end', async ({
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
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  await expect
    .poll(() =>
      gateway.sent.some((event) => event.type === 'input-audio-append'),
    )
    .toBe(true)
  const configuration = gateway.sent.find(
    (event) => event.type === 'session-update',
  )!.config as any
  expect(configuration.inputAudioFormat).toEqual({
    type: 'audio/pcm',
    rate: 16000,
  })
  expect(configuration.outputAudioFormat).toEqual({
    type: 'audio/pcm',
    rate: 24000,
  })
  expect(configuration.voice).toBe('Aoede')
  expect(configuration.inputAudioTranscription).toEqual({})
  expect(configuration.outputAudioTranscription).toEqual({})
  expect(configuration.tools.map((tool: any) => tool.name)).toEqual([
    'read_board',
    'read_shapes',
    'edit_html',
    'apply_actions',
    'inspect_canvas',
  ])
  expect(
    configuration.tools.find((tool: any) => tool.name === 'read_shapes')
      .parameters,
  ).toMatchObject({
    type: 'object',
    properties: { ids: { type: 'array' } },
    required: ['ids'],
  })
  await page
    .getByRole('button', { name: 'Mute microphone', exact: true })
    .click()
  expect(
    await page.evaluate(() =>
      (window as any).testStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true)
  await page
    .getByRole('button', { name: 'Unmute microphone', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'End voice session', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      (window as any).testStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true)
})

test('the transcript starts closed and the canvas stays full width', async ({
  page,
}) => {
  await mockGateway(page)
  await openWorkspace(page)
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Transcript' })).toHaveCount(0)
  await connectVoice(page)
  await expect(page.locator('[data-voice-state]')).toContainText('Listening')
  const canvas = (await page.locator('[data-canvas]').boundingBox())!
  expect(canvas.x + canvas.width).toBe(page.viewportSize()!.width)
})

test('cancelling a pending microphone request stops late audio without connecting', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    )
    navigator.mediaDevices.getUserMedia = (options) =>
      new Promise((resolve) => {
        ;(window as any).allowTestMicrophone = async () => {
          const stream = await acquire(options)
          ;(window as any).testStream = stream
          resolve(stream)
        }
      })
  })
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Cancel voice connection' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel voice connection' }).click()
  await page.evaluate(() => (window as any).allowTestMicrophone())
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testStream
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === 'ended'),
      ),
    )
    .toBe(true)
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeVisible()
  expect(gateway.sent).toHaveLength(0)
})

test('websites run scripts but cannot read the editor document', async ({
  page,
}) => {
  await openWorkspace(page)
  await openCode(page)
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
  await page.route('**/v1/api/realtime**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'No Vercel project is linked' },
    }),
  )
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(page.locator('[data-notice][data-tone="error"]')).toContainText(
    'AI Gateway',
  )
  await expect(
    page.locator('[data-notice][data-tone="error"]'),
  ).not.toContainText('development credentials')
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeEnabled()
})

test('the transcript shows both sides of the conversation and tool calls', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Show transcript' }).click()
  const transcript = page.getByRole('region', { name: 'Transcript' })
  await expect(transcript).toContainText('Nothing said yet.')
  await page.getByRole('button', { name: 'Show transcript' }).click()
  await connectVoice(page)
  gateway.send({
    type: 'input-transcription-completed',
    itemId: 'input-1',
    transcript: 'Make the heading say Great.',
  })
  gateway.send({
    type: 'audio-transcript-delta',
    responseId: 'response-t',
    itemId: 'output-1',
    delta: 'On it, ',
  })
  gateway.send({
    type: 'audio-transcript-delta',
    responseId: 'response-t',
    itemId: 'output-1',
    delta: 'changing it now.',
  })
  // Gemini streams each call's arguments as one delta before the final event.
  gateway.send({
    type: 'function-call-arguments-delta',
    responseId: 'response-1',
    itemId: 'item-transcript-call',
    callId: 'transcript-call',
    delta: '{}',
  })
  await gateway.call('read_board', {}, 'transcript-call')
  await page.getByRole('button', { name: 'Show transcript' }).click()
  await expect(transcript.locator('[data-role="user"]')).toHaveText(
    'Make the heading say Great.',
  )
  await expect(transcript.locator('[data-role="assistant"]')).toHaveText(
    'On it, changing it now.',
  )
  await expect(transcript).toContainText('Looking at your board')
  await expect(transcript.locator('[data-session-divider]')).toHaveCount(0)
  await page.getByRole('button', { name: 'End voice session' }).click()
  await connectVoice(page)
  await expect(transcript.locator('[data-session-divider]')).toHaveCount(1)
  await expect(transcript.locator('[data-role="user"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close transcript' }).click()
  await expect(transcript).toHaveCount(0)
})

test('the open board lives in the URL and the current one renames in place', async ({
  page,
}) => {
  await openWorkspace(page)
  await expect(page).toHaveURL(/\/v1\/page$/)
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  await expect(page).toHaveURL(/\/v1\/(?!page$)[^/]+$/)
  const second = page.url()
  await page.goBack()
  await expect(page).toHaveURL(/\/v1\/page$/)
  await expect(
    page.getByRole('button', { name: 'First ideas', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'First ideas', exact: true }).click()
  const rename = page.getByRole('textbox', { name: 'Rename First ideas' })
  await rename.fill('Moodboard')
  await rename.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Moodboard', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('textbox', { name: 'Board name' })).toHaveValue(
    'Moodboard',
  )
  await expect
    .poll(async () =>
      (await savedRecords(page)).some(
        (record) => record.typeName === 'page' && record.name === 'Moodboard',
      ),
    )
    .toBe(true)
  await page.goto(second)
  await expect(
    page.getByRole('button', { name: 'Untitled board 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-website] iframe')).toHaveCount(0)
})

test('the thinking level cycles, is fixed during a session, and is remembered', async ({
  page,
}) => {
  const tokens: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/v1/api/realtime')) tokens.push(request.url())
  })
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  const picker = page.getByRole('button', { name: /^Thinking: / })
  await expect(picker).toHaveAccessibleName('Thinking: low')
  await connectVoice(page)
  await expect(picker).toBeDisabled()
  expect(tokens.at(-1)).toContain('thinking=low')
  const session = () =>
    gateway.sent.findLast((event) => event.type === 'session-update')!
      .config as any
  expect(session().providerOptions).toEqual({
    google: {
      defaultToolBehavior: 'NON_BLOCKING',
      thinkingConfig: { thinkingLevel: 'low' },
    },
  })
  // Extended thinking ends the turn and keeps reasoning until it's idle.
  gateway.send({
    type: 'custom',
    rawType: 'interactionStatus',
    raw: { serverContent: { interactionStatus: 'IN_PROGRESS' } },
  })
  gateway.send({
    type: 'response-done',
    responseId: 'think',
    status: 'completed',
  })
  await expect(page.locator('[data-voice-state]')).toContainText('Thinking')
  gateway.send({
    type: 'custom',
    rawType: 'interactionStatus',
    raw: { serverContent: { interactionStatus: 'IDLE' } },
  })
  await expect(page.locator('[data-voice-state]')).toContainText('Listening')
  await page.getByRole('button', { name: 'End voice session' }).click()
  for (const level of ['medium', 'high', 'none', 'low', 'medium'])
    await picker
      .click()
      .then(() => expect(picker).toHaveAccessibleName(`Thinking: ${level}`))
  await page.reload()
  await expect(picker).toHaveAccessibleName('Thinking: medium')
  await connectVoice(page)
  expect(tokens.at(-1)).toContain('thinking=medium')
  expect(session().providerOptions.google.thinkingConfig).toEqual({
    thinkingLevel: 'medium',
  })
  await page.getByRole('button', { name: 'End voice session' }).click()
  await picker.click()
  await picker.click()
  await expect(picker).toHaveAccessibleName('Thinking: none')
  await connectVoice(page)
  expect(tokens.at(-1)).toContain('thinking=none')
  expect(session().providerOptions).toEqual({
    google: { defaultToolBehavior: 'NON_BLOCKING' },
  })
})

test('duplicating a board from its context menu copies its shapes', async ({
  page,
}) => {
  await openWorkspace(page)
  await page
    .getByRole('button', { name: 'First ideas', exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'First ideas Copy', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-website] iframe')).toHaveCount(1)
  await expect
    .poll(
      async () =>
        (await savedRecords(page)).filter(
          (record) => record.typeName === 'shape' && record.type === 'website',
        ).length,
    )
    .toBe(2)
})

test('typed messages go to the live session from the transcript', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Show transcript' }).click()
  const input = page.getByRole('textbox', { name: 'Message' })
  await expect(input).toBeDisabled()
  await expect(input).toHaveAttribute('placeholder', 'Start voice to type')
  await connectVoice(page)
  await expect(input).toBeFocused()
  // The website is selected; typing must not reach tldraw's shortcuts.
  await input.pressSequentially('Make the heading redd')
  await input.press('Backspace')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(page.locator('[data-website] iframe')).toHaveCount(1)
  // The fake microphone keeps streaming, so skip audio between the events.
  const typed = () =>
    gateway.sent
      .filter((event) => event.type !== 'input-audio-append')
      .map((event: any) => event.item?.text ?? event.type)
  await expect
    .poll(() => typed().slice(-2))
    .toEqual(['Make the heading red', 'response-create'])
  await expect(
    page
      .getByRole('region', { name: 'Transcript' })
      .locator('[data-role="user"]'),
  ).toHaveText('Make the heading red')
  await page.getByRole('button', { name: 'End voice session' }).click()
  await expect(input).toBeDisabled()
})

test('deleting a board from its context menu is undoable, and the last one stays', async ({
  page,
}) => {
  await openWorkspace(page)
  await page
    .getByRole('button', { name: 'First ideas', exact: true })
    .click({ button: 'right' })
  await expect(
    page.getByRole('menuitem', { name: 'Delete', exact: true }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Untitled board 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await page
    .getByRole('button', { name: 'First ideas', exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'First ideas', exact: true }),
  ).toHaveCount(0)
  await expect
    .poll(async () =>
      (await savedRecords(page)).some(
        (record) => record.typeName === 'page' && record.name === 'First ideas',
      ),
    )
    .toBe(false)
  await page.locator('[data-canvas]').click({ position: { x: 400, y: 400 } })
  await page.keyboard.press('ControlOrMeta+z')
  await expect(
    page.getByRole('button', { name: 'First ideas', exact: true }),
  ).toBeVisible()
})

test('read_board tells what the user points at apart from what the agent just changed', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  // "Add this here": the agent creates a box.
  const created = await gateway.call('apply_actions', {
    actions: [
      {
        op: 'create',
        shape: {
          id: 'shape:box',
          type: 'geo',
          x: -400,
          y: 0,
          props: { w: 200, h: 120 },
        },
      },
    ],
  })
  expect(created.createdIds).toEqual(['shape:box'])
  await gateway.call('apply_actions', { actions: [{ op: 'select', ids: [] }] })
  // Then the user points at the note and at empty canvas: "move this there".
  const note = page
    .getByTestId('canvas')
    .getByText('What if this felt a little more playful?', { exact: true })
  const box = (await note.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(700)
  const empty = (await page.locator('[data-canvas]').boundingBox())!
  await page.mouse.move(empty.x + empty.width - 120, empty.y + 140, {
    steps: 4,
  })
  await page.waitForTimeout(700)
  const board = await gateway.call('read_board', {})
  const noteId = board.shapes.find((shape: any) => shape.type === 'note').id
  expect(board.selectedIds).toEqual([])
  const [there, pointedAt] = board.attention.pointerRests
  expect(there.shapeId).toBeNull()
  expect(pointedAt.shapeId).toBe(noteId)
  expect(pointedAt.secondsAgo).toBeGreaterThan(there.secondsAgo)
  expect(board.attention.yourChanges).toEqual([
    expect.objectContaining({ kind: 'created', ids: ['shape:box'] }),
  ])
})
