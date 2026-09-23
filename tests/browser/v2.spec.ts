import { test, expect, type Page } from '@playwright/test'
import { mockGateway } from './gateway'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { prepareHtml } from '../../src/lib/v2/html'

async function mockFiles(page: Page) {
  const initial = await page.request.get('/api/v2/site')
  let site = await initial.json()
  let created = 0
  const directory = test.info().outputPath('site')
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/index.html`, site.html)
  await page.route('**/api/v2/site', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      site.persisted = true
      created++
    }
    await route.fulfill({ json: site })
  })
  await page.route('**/api/v2/bash', async (route) => {
    const { command } = route.request().postDataJSON()
    const output = await new Promise((resolve) => {
      execFile(
        'bash',
        ['-c', command],
        { cwd: directory, timeout: 5000 },
        (error, stdout, stderr) => {
          resolve({
            exitCode: error ? Number(error.code) || 1 : 0,
            stdout,
            stderr,
          })
        },
      )
    })
    site.html = prepareHtml(await readFile(`${directory}/index.html`, 'utf8'))
    await writeFile(`${directory}/index.html`, site.html)
    await route.fulfill({
      json: { ...(output as object), site, previewError: null },
    })
  })
  await page.route('**/api/v2/annotations', async (route) => {
    const data = route.request().postDataJSON()
    site.annotations =
      route.request().method() === 'DELETE'
        ? site.annotations.filter((note: any) => note.id !== data.id)
        : [...site.annotations, data]
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
  const source = `const fs = require('node:fs'); const html = fs.readFileSync('index.html', 'utf8'); fs.writeFileSync('index.html', html.replace(${JSON.stringify(search)}, ${JSON.stringify(replace)}));`
  return { command: `node <<'JS'\n${source}\nJS` }
}

async function drawOnHeading(page: Page) {
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
  const gateway = await mockGateway(page, '**/api/v2/realtime')
  await page.goto('/v2')
  await page.getByRole('button', { name: 'Draw on the website' }).click()
  await drawOnHeading(page)
  await expect.poll(() => files.site.annotations.length).toBe(1)
  expect(files.created).toBe(1)
  const drawing = files.site.annotations[0]
  expect(drawing.target.tag).toBe('h1')
  expect(drawing.drawing.points.length).toBeGreaterThan(5)
  expect(drawing.drawing.targets[0].text).toContain('Good spaces.')
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
  expect(context.annotations[0].drawing.points).toEqual(drawing.drawing.points)
  expect(context.annotations[0].drawing.targets[0]).toMatchObject({
    id: drawing.target.id,
    attached: true,
  })
  expect(
    gateway.sent.filter((event: any) => event.item?.type === 'text-message'),
  ).toEqual([])
  await gateway.call('bash', replaceCopy('Good spaces.', 'Great spaces.'))
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
  await expect(page.locator('.v2-notes')).toContainText('Freehand drawing')
  await page.getByRole('button', { name: 'Delete annotation 1' }).click()
  await expect(path).toHaveCount(0)
  await page.reload()
  await expect(preview.locator('[data-margin-drawing]')).toHaveCount(0)
})

test('failed drawing saves retain the stroke for retry', async ({ page }) => {
  const files = await mockFiles(page)
  let fail = true
  await page.route('**/api/v2/annotations', async (route) => {
    if (!fail) return route.fallback()
    await route.fulfill({ status: 503, json: { error: 'Test save failure' } })
  })
  await page.goto('/v2')
  await page.getByRole('button', { name: 'Draw on the website' }).click()
  await drawOnHeading(page)
  await expect(page.locator('.v2-notice')).toContainText('Test save failure')
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
}) => {
  const headers = { Origin: 'http://localhost:3000' }
  const initial = await request.get('/api/v2/site')
  expect(initial.status()).toBe(200)
  expect((await initial.json()).persisted).toBe(false)
  const write = await request.post('/api/v2/bash', {
    headers,
    data: { command: 'pwd' },
  })
  expect(write.status()).toBe(401)
  const voice = await request.post('/api/v2/realtime', { headers })
  expect(voice.status()).toBe(401)
  const foreign = await request.post('/api/v2/site', {
    headers: { Origin: 'https://another.example' },
  })
  expect(foreign.status()).toBe(403)
  const foreignBash = await request.post('/api/v2/bash', {
    headers: { Origin: 'https://another.example' },
    data: { command: 'pwd' },
  })
  expect(foreignBash.status()).toBe(403)
})

test('one click starts voice, notes target DOM elements, and edits reload from the server', async ({
  page,
}) => {
  const files = await mockFiles(page)
  const gateway = await mockGateway(page, '**/api/v2/realtime')
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
  const source = await gateway.call('bash', { command: 'cat index.html' })
  expect(source.exitCode).toBe(0)
  expect(source.stdout).toContain(selection.selection.id)
  const failed = await gateway.call('bash', {
    command: 'echo "fixable error" >&2; exit 7',
  })
  expect(failed.exitCode).toBe(7)
  expect(failed.stderr).toContain('fixable error')
  const edit = await gateway.call('bash', replaceCopy('Good spaces.', 'Great.'))
  expect(edit.exitCode).toBe(0)
  expect(edit).not.toHaveProperty('site')
  await expect(preview.getByRole('heading', { level: 1 })).toContainText(
    'Great.',
  )
  await expect(page.locator('.v2-selection')).toContainText('Great.')
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
  await expect(page.locator('.v2-notes')).toContainText('Make this say Great.')
  await page.getByRole('button', { name: 'Delete annotation 1' }).click()
  await expect(page.locator('.v2-notes article')).toHaveCount(0)
  await page.getByRole('button', { name: 'View website source' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Website HTML source' }),
  ).toHaveValue(/Great\./)
})

test('a deleted target stays identifiable in its note without blocking further edits', async ({
  page,
}) => {
  await mockFiles(page)
  const gateway = await mockGateway(page, '**/api/v2/realtime')
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
  await gateway.call('bash', {
    command: `cat > index.html <<'HTML'
<!doctype html><html><body><h1 data-margin-id="new-heading">A new page</h1></body></html>
HTML`,
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
  await gateway.call('bash', replaceCopy('A new page', 'Another idea'))
  await expect(preview.getByRole('heading')).toHaveText('Another idea')
})

test('cancelling remote setup prevents a late voice connection', async ({
  page,
}) => {
  const files = await mockFiles(page)
  const gateway = await mockGateway(page, '**/api/v2/realtime')
  let finish: (() => Promise<void>) | undefined
  await page.route('**/api/v2/site', async (route) => {
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
