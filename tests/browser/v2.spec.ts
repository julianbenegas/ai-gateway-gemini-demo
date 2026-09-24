import { test, expect, type Page } from '@playwright/test'
import { mockGateway } from './gateway'
import { applyReplacements } from '../../src/lib/replacements'
import type { Design, SiteDocument } from '../../src/app/v2/_lib/types'
import { prepareHtml } from '../../src/app/v2/_server/html'

async function mockFiles(page: Page) {
  const initial = (await (
    await page.request.get('/v2/api/starter')
  ).json()) as SiteDocument
  let site = initial
  let created = 0
  const sites = new Map<string, SiteDocument>()
  const designs: Design[] = []
  const designId = (url: string) => new URL(url).pathname.split('/')[4]
  await page.route('**/v2/api/designs', async (route) => {
    if (route.request().method() !== 'POST')
      return route.fulfill({ json: designs })
    const id = crypto.randomUUID()
    site = { ...initial, id, persisted: true, annotations: [] }
    sites.set(id, site)
    designs.push({ id, name: `Design ${++created}`, createdAt: Date.now() })
    await route.fulfill({ json: site })
  })
  await page.route('**/v2/api/designs/*', async (route) => {
    site = sites.get(designId(route.request().url()))!
    if (route.request().method() !== 'PATCH')
      return route.fulfill({ json: site })
    const edit = route.request().postDataJSON()
    const result =
      'html' in edit
        ? { html: edit.html, matches: undefined }
        : applyReplacements(site.html, edit.replacements)
    site.html = prepareHtml(result.html)
    await route.fulfill({
      json: {
        site,
        matches: result.matches,
        missed: !!result.matches?.includes(0),
      },
    })
  })
  await page.route('**/v2/api/designs/*/annotations**', async (route) => {
    const { pathname } = new URL(route.request().url())
    site = sites.get(pathname.split('/')[4])!
    site.annotations =
      route.request().method() === 'DELETE'
        ? site.annotations.filter((note) => note.id !== pathname.split('/')[6])
        : [...site.annotations, route.request().postDataJSON()]
    await route.fulfill({ json: site.annotations })
  })
  return {
    get created() {
      return created
    },
    get site() {
      return site
    },
  }
}

function replaceCopy(search: string, replace: string) {
  return { replacements: [{ search, replace }] }
}

async function drawOnHeading(page: Page) {
  await expect(
    page.frameLocator('iframe[title="Website preview"]').locator('html'),
  ).toHaveAttribute('data-margin-mode', 'draw')
  const heading = page
    .frameLocator('iframe[title="Website preview"]')
    .getByRole('heading', { level: 1 })
  const box = (await heading.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 25)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 40, { steps: 12 })
  await page.mouse.move(box.x + 120, box.y + 20, { steps: 6 })
  await page.mouse.up()
}

test('freehand drawings stay anchored, persist, and give the agent DOM context on demand', async ({
  page,
}) => {
  const files = await mockFiles(page)
  const gateway = await mockGateway(page, '**/v2/api/realtime')
  await page.goto('/v2')
  await page.getByRole('button', { name: 'Draw on the website' }).click()
  await drawOnHeading(page)
  await expect.poll(() => files.site.annotations.length).toBe(1)
  expect(files.created).toBe(1)
  const drawing = files.site.annotations[0]
  expect(drawing.target.tag).toBe('h1')
  expect(drawing.drawing!.points.length).toBeGreaterThan(5)
  expect(drawing.drawing!.targets[0].text).toContain('Good spaces.')
  const preview = page.frameLocator('iframe[title="Website preview"]')
  const path = preview.locator(`[data-margin-drawing="${drawing.id}"]`)
  await expect(path).toHaveCount(1)
  const originalPoints = await path.getAttribute('points')
  await page
    .getByRole('button', { name: 'Talk and annotate', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Draw on the website' }),
  ).toHaveAttribute('aria-pressed', 'true')
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
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'Great spaces.',
  )
  await expect(path).toHaveAttribute('points', originalPoints!)
  const updated = await gateway.call('read_selection', {})
  expect(updated.annotations[0].drawing.targets[0].text).toContain(
    'Great spaces.',
  )
  await page.setViewportSize({ width: 1100, height: 760 })
  await expect(path).not.toHaveAttribute('points', originalPoints!)
  await page.mouse.move(1000, 350)
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
  await expect(preview.locator('[data-margin-drawing]')).toHaveCount(0)
})

test('failed drawing saves retain the stroke for retry', async ({ page }) => {
  const files = await mockFiles(page)
  let fail = true
  await page.route('**/v2/api/designs/*/annotations**', async (route) => {
    if (!fail) return route.fallback()
    await route.fulfill({ status: 503, json: { error: 'Test save failure' } })
  })
  await page.goto('/v2')
  await page.getByRole('button', { name: 'Draw on the website' }).click()
  await drawOnHeading(page)
  await expect(page.locator('[data-notice]')).toContainText('Test save failure')
  const paths = page
    .frameLocator('iframe[title="Website preview"]')
    .locator('[data-margin-drawing]')
  await expect(paths).toHaveCount(1)
  expect(files.site.annotations).toEqual([])
  fail = false
  await page.getByRole('button', { name: 'Retry save' }).click()
  await expect.poll(() => files.site.annotations.length).toBe(1)
  await page.reload()
  await expect(paths).toHaveCount(1)
})

test('v2 owns its session before exposing remote file and voice tools', async ({
  request,
  baseURL,
}) => {
  const headers = { Origin: new URL(baseURL!).origin }
  const initial = await request.get('/v2/api/starter')
  expect(initial.status()).toBe(200)
  expect((await initial.json()).persisted).toBe(false)
  const designId = crypto.randomUUID()
  const write = await request.patch(`/v2/api/designs/${designId}`, {
    headers,
    data: { html: '<h1>Mine</h1>' },
  })
  expect(write.status()).toBe(401)
  const voice = await request.post('/v2/api/realtime', { headers })
  expect(voice.status()).toBe(401)
  const foreign = await request.post('/v2/api/designs', {
    headers: { Origin: 'https://another.example' },
  })
  expect(foreign.status()).toBe(403)
  const foreignWrite = await request.patch(`/v2/api/designs/${designId}`, {
    headers: { Origin: 'https://another.example' },
    data: { html: '<h1>Mine</h1>' },
  })
  expect(foreignWrite.status()).toBe(403)
})

test('one click starts voice, notes target DOM elements, and edits reload from the server', async ({
  page,
}) => {
  const files = await mockFiles(page)
  const gateway = await mockGateway(page, '**/v2/api/realtime')
  await page.goto('/v2')
  const preview = page.frameLocator('iframe[title="Website preview"]')
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'Good spaces.',
  )
  await page
    .getByRole('button', { name: 'Talk and annotate', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  expect(files.created).toBe(1)
  await preview
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
    replaceCopy('Good spaces.', 'Great.'),
  )
  expect(edit).toEqual({ ok: true, matches: [1] })
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'Great.',
  )
  await expect(page.locator('[data-selection]')).toContainText('Great.')
  await expect
    .poll(
      async () => (await gateway.call('read_selection', {})).selection?.text,
    )
    .toContain('Great.')
  const injected = gateway.sent.filter(
    (event: any) => event.item?.type === 'text-message',
  )
  expect(injected).toEqual([])
  await page.reload()
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
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
  await mockFiles(page)
  const gateway = await mockGateway(page, '**/v2/api/realtime')
  await page.goto('/v2')
  await page
    .getByRole('button', { name: 'Talk and annotate', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  const preview = page.frameLocator('iframe[title="Website preview"]')
  await preview
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
  await expect(preview.getByRole('heading')).toHaveText('A new page')
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
  await expect(preview.getByRole('heading')).toHaveText('Another idea')
})

test('cancelling remote setup prevents a late voice connection', async ({
  page,
}) => {
  const files = await mockFiles(page)
  const gateway = await mockGateway(page, '**/v2/api/realtime')
  let finish: (() => Promise<void>) | undefined
  await page.route('**/v2/api/designs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise<void>((resolve) => {
      finish = async () => {
        await route.fulfill({ json: { ...files.site, persisted: true } })
        resolve()
      }
    })
  })
  await page.goto('/v2')
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

test('the sidebar creates independent designs and reopens the last one after refresh', async ({
  page,
}) => {
  await mockFiles(page)
  const gateway = await mockGateway(page, '**/v2/api/realtime')
  await page.goto('/v2')
  await page.getByRole('button', { name: 'New design', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Design 1', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await page
    .getByRole('button', { name: 'Talk and annotate', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  await gateway.call('edit_html', replaceCopy('Good spaces.', 'First design.'))
  const preview = page.frameLocator('iframe[title="Website preview"]')
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'First design.',
  )
  await page.getByRole('button', { name: 'New design', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Design 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('button', { name: 'Talk and annotate', exact: true }),
  ).toBeVisible()
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'Good spaces.',
  )
  await page.getByRole('button', { name: 'Design 1', exact: true }).click()
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'First design.',
  )
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Design 1', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'First design.',
  )
})
