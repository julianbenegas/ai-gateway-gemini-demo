import { test, expect, type Page } from '@playwright/test'
import { mockGateway } from './gateway'
import type { SiteDocument } from '../../src/app/v2/_lib/types'

// These run against the real v2 API, whose store is in memory for tests.
// Only the Gateway WebSocket is simulated.

const FIXTURE = `<!doctype html><html><head><style>body{margin:0;font-family:Georgia,serif;background:#f4f1ea;color:#28372f}main{padding:80px;min-height:2400px}h1{font-size:72px;font-weight:400;margin:0 0 24px}</style></head><body><main><h1>Good spaces. Better living.</h1><p>Thoughtful places for the everyday.</p></main></body></html>`

const preview = (page: Page) =>
  page.frameLocator('iframe[title="Website preview"]')

async function createDesign(page: Page) {
  const before = page.url()
  await page
    .getByRole('complementary', { name: 'Designs' })
    .getByRole('button', { name: 'New design' })
    .click()
  await page.waitForURL(
    (url) => url.href !== before && /\/v2\/[0-9a-f-]{36}$/.test(url.pathname),
  )
  return new URL(page.url()).pathname.split('/')[2]
}

async function startVoice(page: Page) {
  await page
    .getByRole('button', { name: 'Talk and annotate', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
}

/** A new design whose page the agent wrote, with voice still connected. */
async function openFixture(page: Page) {
  const gateway = await mockGateway(page, '**/v2/api/realtime**')
  await page.goto('/v2')
  const id = await createDesign(page)
  await startVoice(page)
  await gateway.call('write_html', { html: FIXTURE })
  await expect(preview(page).getByRole('heading', { level: 1 })).toContainText(
    'Good spaces.',
  )
  return { id, gateway }
}

async function savedDesign(page: Page, id: string) {
  return (await (
    await page.request.get(`/v2/api/designs/${id}`)
  ).json()) as SiteDocument
}

function replaceCopy(search: string, replace: string) {
  return { replacements: [{ search, replace }] }
}

async function drawOnHeading(page: Page) {
  await expect(preview(page).locator('html')).toHaveAttribute(
    'data-margin-mode',
    'draw',
  )
  const heading = preview(page).getByRole('heading', { level: 1 })
  const box = (await heading.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 25)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 40, { steps: 12 })
  await page.mouse.move(box.x + 120, box.y + 20, { steps: 6 })
  await page.mouse.up()
}

test('with no designs there is an empty state, and designs live at their URL', async ({
  page,
}) => {
  await page.goto('/v2')
  await expect(page).toHaveURL(/\/v2$/)
  await expect(
    page.getByRole('button', { name: 'Talk and annotate' }),
  ).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  await page
    .getByRole('main')
    .getByRole('button', { name: 'New design' })
    .last()
    .click()
  await expect(page).toHaveURL(/\/v2\/[0-9a-f-]{36}$/)
  const url = page.url()
  await expect(
    page.getByRole('button', { name: 'Design 1', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('button', { name: 'Talk and annotate' }),
  ).toBeVisible()
  await page.goto('/v2')
  await expect(page).toHaveURL(url)
  await page.goto(`/v2/${crypto.randomUUID()}`)
  await expect(page.getByText('404')).toBeVisible()
})

test('clicking the current design renames it', async ({ page }) => {
  await page.goto('/v2')
  const id = await createDesign(page)
  await page.getByRole('button', { name: 'Design 1', exact: true }).click()
  const rename = page.getByRole('textbox', { name: 'Rename Design 1' })
  await rename.fill('Discarded')
  await rename.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Design 1', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Design 1', exact: true }).click()
  await rename.fill('Homepage')
  await rename.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Homepage', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('header')).toContainText('Homepage')
  await expect
    .poll(async () => (await page.request.get('/v2/api/designs')).json())
    .toMatchObject([{ id, name: 'Homepage' }])
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Homepage', exact: true }),
  ).toBeVisible()
})

test('freehand drawings stay anchored, persist, and give the agent DOM context on demand', async ({
  page,
}) => {
  const { id, gateway } = await openFixture(page)
  await page.getByRole('button', { name: 'End voice session' }).click()
  await page.getByRole('button', { name: 'Draw on the website' }).click()
  await startVoice(page)
  await expect(
    page.getByRole('button', { name: 'Draw on the website' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await drawOnHeading(page)
  await expect
    .poll(async () => (await savedDesign(page, id)).annotations.length)
    .toBe(1)
  const [drawing] = (await savedDesign(page, id)).annotations
  expect(drawing.target.tag).toBe('h1')
  expect(drawing.drawing!.points.length).toBeGreaterThan(5)
  expect(drawing.drawing!.targets[0].text).toContain('Good spaces.')
  const path = preview(page).locator(`[data-margin-drawing="${drawing.id}"]`)
  await expect(path).toHaveCount(1)
  const originalPoints = await path.getAttribute('points')
  const context = await gateway.call('read_selection', {})
  expect(context.selection).toBeNull()
  expect(context.annotations[0].drawing.points).toEqual(drawing.drawing!.points)
  expect(context.annotations[0].drawing.targets[0]).toMatchObject({
    id: drawing.target.id,
    attached: true,
  })
  expect(
    gateway.sent.filter((event: any) => event.item?.type === 'text-message'),
  ).toEqual([])
  await gateway.call('edit_html', replaceCopy('Good spaces.', 'Great spaces.'))
  await expect(preview(page).getByRole('heading', { level: 1 })).toContainText(
    'Great spaces.',
  )
  await expect(path).toHaveAttribute('points', originalPoints!)
  const updated = await gateway.call('read_selection', {})
  expect(updated.annotations[0].drawing.targets[0].text).toContain(
    'Great spaces.',
  )
  await page.setViewportSize({ width: 1100, height: 760 })
  await expect(path).not.toHaveAttribute('points', originalPoints!)
  await page.mouse.move(700, 350)
  const beforeScroll = await path.getAttribute('points')
  await page.mouse.wheel(0, 150)
  await expect(path).not.toHaveAttribute('points', beforeScroll!)
  await page.reload()
  await expect(path).toHaveCount(1)
  await page.getByRole('button', { name: 'Draw on the website' }).click()
  await drawOnHeading(page)
  await expect(
    page.getByRole('button', { name: 'Show annotations' }),
  ).toHaveText('2')
  await page.getByRole('button', { name: 'Undo drawing' }).click()
  await expect(
    page.getByRole('button', { name: 'Show annotations' }),
  ).toHaveText('1')
  await expect(path).toHaveCount(1)
  await page.getByRole('button', { name: 'Show annotations' }).click()
  await expect(page.locator('[data-notes]')).toContainText('Freehand drawing')
  await page.getByRole('button', { name: 'Delete annotation 1' }).click()
  await expect(path).toHaveCount(0)
  await page.reload()
  await expect(preview(page).locator('[data-margin-drawing]')).toHaveCount(0)
})

test('failed drawing saves retain the stroke for retry', async ({ page }) => {
  const { id } = await openFixture(page)
  let fail = true
  await page.route('**/v2/api/designs/*/annotations**', async (route) => {
    if (!fail) return route.fallback()
    await route.fulfill({ status: 503, json: { error: 'Test save failure' } })
  })
  await page.getByRole('button', { name: 'Draw on the website' }).click()
  await drawOnHeading(page)
  await expect(page.locator('[data-notice]')).toContainText('Test save failure')
  const paths = preview(page).locator('[data-margin-drawing]')
  await expect(paths).toHaveCount(1)
  expect((await savedDesign(page, id)).annotations).toEqual([])
  fail = false
  await page.getByRole('button', { name: 'Retry save' }).click()
  await expect
    .poll(async () => (await savedDesign(page, id)).annotations.length)
    .toBe(1)
  await page.reload()
  await expect(paths).toHaveCount(1)
})

test('v2 owns its session before exposing remote file and voice tools', async ({
  request,
  baseURL,
}) => {
  const headers = { Origin: new URL(baseURL!).origin }
  const designs = await request.get('/v2/api/designs')
  expect(await designs.json()).toEqual([])
  const designId = crypto.randomUUID()
  const grant = await request.post('/v2/api/grants', {
    headers,
    data: { designId },
  })
  expect(grant.status()).toBe(401)
  const rename = await request.patch(`/v2/api/designs/${designId}`, {
    headers,
    data: { name: 'Mine' },
  })
  expect(rename.status()).toBe(401)
  const write = await request.post('/v2/api/agent/write_html', {
    headers: { ...headers, 'x-tool-call-id': 'call-1' },
    data: { html: '<h1>Mine</h1>' },
  })
  expect(write.status()).toBe(401)
  const forged = await request.post('/v2/api/agent/write_html', {
    headers: {
      ...headers,
      authorization: 'Bearer not-a-real-grant-token-at-all',
      'x-tool-call-id': 'call-2',
    },
    data: { html: '<h1>Mine</h1>' },
  })
  expect(forged.status()).toBe(401)
  const voice = await request.post('/v2/api/realtime', { headers })
  expect(voice.status()).toBe(401)
  const foreign = await request.post('/v2/api/designs', {
    headers: { Origin: 'https://another.example' },
  })
  expect(foreign.status()).toBe(403)
  const foreignWrite = await request.post('/v2/api/agent/write_html', {
    headers: { Origin: 'https://another.example', 'x-tool-call-id': 'call-3' },
    data: { html: '<h1>Mine</h1>' },
  })
  expect(foreignWrite.status()).toBe(403)
})

test('notes target DOM elements, and agent edits reload from the server', async ({
  page,
}) => {
  const { gateway } = await openFixture(page)
  await preview(page)
    .getByRole('heading', { level: 1 })
    .click({ position: { x: 20, y: 20 } })
  await expect(
    page.getByRole('button', { name: 'Add annotation', exact: true }),
  ).toBeEnabled()
  const selection = await gateway.call('read_selection', {})
  expect(selection.selection.tag).toBe('h1')
  expect(selection.selection.text).toContain('Good spaces.')
  expect(selection.selection.html).toContain('data-margin-id')
  await page
    .getByRole('button', { name: 'Add annotation', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Note on this h1' })
    .fill('Make this say Great.')
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Show annotations' }),
  ).toHaveText('1')
  const context = await gateway.call('read_selection', {})
  expect(context.annotations[0]).toMatchObject({
    comment: 'Make this say Great.',
    attached: true,
    target: { id: selection.selection.id },
  })
  const source = await gateway.call('read_html', {})
  expect(source.html).toContain(selection.selection.id)
  const missed = await gateway.call(
    'edit_html',
    replaceCopy('Not on this page', 'Nothing'),
  )
  expect(missed.matches).toEqual([0])
  expect(missed.html).toContain('Good spaces.')
  const edit = await gateway.call(
    'edit_html',
    replaceCopy('Good spaces. Better living.', 'Great.'),
  )
  expect(edit).toEqual({ ok: true, matches: [1] })
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText(
    'Great.',
  )
  await expect(page.locator('[data-selection]')).toContainText('Great.')
  await expect
    .poll(
      async () => (await gateway.call('read_selection', {})).selection?.text,
    )
    .toContain('Great.')
  expect(
    gateway.sent.filter((event: any) => event.item?.type === 'text-message'),
  ).toEqual([])
  await page.reload()
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText(
    'Great.',
  )
  await page.getByRole('button', { name: 'Show annotations' }).click()
  await expect(page.locator('[data-notes]')).toContainText(
    'Make this say Great.',
  )
  await page.getByRole('button', { name: 'Delete annotation 1' }).click()
  await expect(page.locator('[data-notes] article')).toHaveCount(0)
  await page.getByRole('button', { name: 'View website source' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Website HTML source' }),
  ).toHaveValue(/Great\./)
})

test('a deleted target stays identifiable in its note without blocking further edits', async ({
  page,
}) => {
  const { gateway } = await openFixture(page)
  await preview(page)
    .getByRole('heading', { level: 1 })
    .click({ position: { x: 20, y: 20 } })
  await page
    .getByRole('button', { name: 'Add annotation', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Note on this h1' })
    .fill('Remove this heading.')
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Show annotations' }),
  ).toBeVisible()
  await gateway.call('write_html', {
    html: '<!doctype html><html><body><h1 data-margin-id="new-heading">A new page</h1></body></html>',
  })
  await expect(preview(page).getByRole('heading')).toHaveText('A new page')
  await expect
    .poll(
      async () =>
        (await gateway.call('read_selection', {})).annotations?.[0]?.attached,
    )
    .toBe(false)
  const context = await gateway.call('read_selection', {})
  expect(context.selection).toBeNull()
  expect(context.annotations[0].target.text).toContain('Good spaces.')
  await gateway.call('edit_html', replaceCopy('A new page', 'Another idea'))
  await expect(preview(page).getByRole('heading')).toHaveText('Another idea')
})

test('cancelling voice setup prevents a late connection', async ({ page }) => {
  const gateway = await mockGateway(page, '**/v2/api/realtime**')
  await page.goto('/v2')
  await createDesign(page)
  let finish: (() => Promise<void>) | undefined
  await page.route('**/v2/api/grants', async (route) => {
    await new Promise<void>((resolve) => {
      finish = async () => {
        await route.fallback()
        resolve()
      }
    })
  })
  await page
    .getByRole('button', { name: 'Talk and annotate', exact: true })
    .click()
  await expect.poll(() => Boolean(finish)).toBe(true)
  await page
    .getByRole('button', { name: 'Cancel voice connection', exact: true })
    .click()
  await finish!()
  await expect(
    page.getByRole('button', { name: 'Talk and annotate', exact: true }),
  ).toBeVisible()
  expect(gateway.sent).toEqual([])
})

test('the sidebar opens independent designs by URL', async ({ page }) => {
  const { id: first, gateway } = await openFixture(page)
  await gateway.call('edit_html', replaceCopy('Good spaces.', 'First design.'))
  await expect(preview(page).getByRole('heading', { level: 1 })).toContainText(
    'First design.',
  )
  const second = await createDesign(page)
  await expect(
    page.getByRole('button', { name: 'Design 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('button', { name: 'Talk and annotate', exact: true }),
  ).toBeVisible()
  await expect(preview(page).getByRole('heading')).toHaveCount(0)
  await page.getByRole('link', { name: 'Design 1', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/v2/${first}$`))
  await expect(preview(page).getByRole('heading', { level: 1 })).toContainText(
    'First design.',
  )
  // A client-side back navigation, which fires no load event to wait for.
  await page.evaluate(() => history.back())
  await expect(page).toHaveURL(new RegExp(`/v2/${second}$`))
  await expect(
    page.getByRole('button', { name: 'Design 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Design 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
})

test('agent edits carry the voice session grant and can be undone', async ({
  page,
}) => {
  const agentRequests: { url: string; headers: Record<string, string> }[] = []
  page.on('request', (request) => {
    if (request.url().includes('/v2/api/agent/'))
      agentRequests.push({ url: request.url(), headers: request.headers() })
  })
  const { gateway } = await openFixture(page)
  const grant = agentRequests[0].headers.authorization
  expect(grant).toMatch(/^Bearer [\w-]{20,}$/)
  await gateway.call(
    'edit_html',
    replaceCopy('Good spaces.', 'Great.'),
    'edit-call',
  )
  expect(agentRequests.at(-1)).toMatchObject({
    url: expect.stringContaining('/v2/api/agent/edit_html'),
    headers: { authorization: grant, 'x-tool-call-id': 'edit-call' },
  })
  const heading = preview(page).getByRole('heading', { level: 1 })
  await expect(heading).toContainText('Great.')
  const invalid = await gateway.call('write_html', { markup: 'nope' })
  expect(invalid.error).toContain('Invalid write_html arguments')
  const unknown = await gateway.call('delete_site', {})
  expect(unknown.error).toBe('Unknown tool: delete_site')
  const undo = page.getByRole('button', { name: 'Undo agent edit' })
  await undo.click()
  await expect(heading).toContainText('Good spaces.')
  await undo.click()
  await expect(heading).toHaveCount(0)
  await expect(undo).toBeDisabled()
  await page.getByRole('button', { name: 'End voice session' }).click()
  await expect
    .poll(() =>
      agentRequests.some(
        (request) =>
          request.url.endsWith('/v2/api/agent/grant') &&
          request.headers.authorization === grant,
      ),
    )
    .toBe(true)
  const replay = await page.request.post('/v2/api/agent/edit_html', {
    headers: {
      authorization: grant,
      'x-tool-call-id': 'replay',
      Origin: new URL(page.url()).origin,
    },
    data: replaceCopy('Good', 'Stolen'),
  })
  expect(replay.status()).toBe(401)
})

test('duplicating a design copies its page into a new design', async ({
  page,
}) => {
  const { id } = await openFixture(page)
  await page
    .getByRole('button', { name: 'Design 1', exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.endsWith(id))
  await expect(
    page.getByRole('button', { name: 'Design 1 copy', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(preview(page).getByRole('heading', { level: 1 })).toContainText(
    'Good spaces.',
  )
  await expect(
    page.getByRole('button', { name: 'Undo agent edit' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Talk and annotate', exact: true }),
  ).toBeVisible()
})

test('deleting a design asks first and opens another one', async ({ page }) => {
  const { id: first } = await openFixture(page)
  const second = await createDesign(page)
  const openDelete = async (name: string) => {
    await page
      .getByRole('button', { name, exact: true })
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    return page.getByRole('dialog', { name: `Delete ${name}` })
  }
  const dialog = await openDelete('Design 2')
  await expect(dialog).toContainText('permanently deletes')
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await (await openDelete('Design 2')).press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Design 2', exact: true }),
  ).toBeVisible()
  await (
    await openDelete('Design 2')
  )
    .getByRole('button', { name: 'Delete' })
    .click()
  await page.waitForURL(new RegExp(`/v2/${first}$`))
  await expect(
    page.getByRole('button', { name: 'Design 1', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('link', { name: 'Design 2', exact: true }),
  ).toHaveCount(0)
  expect((await page.request.get(`/v2/api/designs/${second}`)).status()).toBe(
    404,
  )
  await (
    await openDelete('Design 1')
  )
    .getByRole('button', { name: 'Delete' })
    .click()
  await page.waitForURL(/\/v2$/)
  await expect(page.getByText('No designs')).toBeVisible()
})
