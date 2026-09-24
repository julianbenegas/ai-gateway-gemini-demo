import { expect, type Page, test } from '@playwright/test'
import { mockGateway } from './gateway'

// The desktop is a real Vercel Sandbox; these tests point its viewer at a
// socket that refuses, and count how often it asks for the desktop.
async function stubDesktop(page: Page) {
  const calls = { count: 0 }
  await page.route('**/v3/api/apps/*/desktop', (route) => {
    calls.count++
    return route.fulfill({ json: { url: 'ws://127.0.0.1:9/websockify' } })
  })
  return calls
}

async function createApp(page: Page) {
  const before = page.url()
  await page
    .getByRole('complementary', { name: 'Apps' })
    .getByRole('button', { name: 'New app' })
    .click()
  await page.waitForURL(
    (url) => url.href !== before && /\/v3\/[0-9a-f-]{36}$/.test(url.pathname),
  )
  return new URL(page.url()).pathname.split('/')[2]
}

test('apps start empty, open by URL beside their desktop, rename, and delete', async ({
  page,
}) => {
  await stubDesktop(page)
  await page.goto('/v3')
  await expect(page.getByText('No apps')).toBeVisible()
  const id = await createApp(page)
  await expect(page.getByRole('region', { name: 'Chat' })).toContainText(
    'Ask the agent to build something.',
  )
  await expect(page.locator('section[aria-label="Desktop"]')).toContainText(
    /Starting the desktop|Reconnecting to the desktop/,
  )
  await expect(
    page.getByRole('button', { name: 'Voice mode', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'App 1', exact: true }).click()
  await page.getByRole('textbox', { name: 'Rename App 1' }).fill('Landing page')
  await page.keyboard.press('Enter')
  await expect
    .poll(async () =>
      (await (await page.request.get('/v3/api/apps')).json()).map(
        (app: { name: string }) => app.name,
      ),
    )
    .toEqual(['Landing page'])
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/v3/${id}$`))
  await expect(
    page.getByRole('button', { name: 'Landing page', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await page
    .getByRole('button', { name: 'Landing page', exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Delete Landing page' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await page.waitForURL(/\/v3$/)
  await expect(page.getByText('No apps')).toBeVisible()
})

test("the agent's event stream only opens the owner's apps", async ({
  page,
}) => {
  await stubDesktop(page)
  await page.goto('/v3')
  expect(
    (
      await page.request.get(`/v3/api/events?sessionId=${crypto.randomUUID()}`)
    ).status(),
  ).toBe(401)
  const id = await createApp(page)
  const history = await page.request.get(
    `/v3/api/events?sessionId=${id}&gte=0&lte=10`,
  )
  expect(history.status()).toBe(200)
  const other = await page.request.get(
    `/v3/api/events?sessionId=${crypto.randomUUID()}&gte=0&lte=10`,
  )
  expect(other.status()).toBe(403)
  const push = await page.request.post('/v3/api/events', {
    headers: { origin: 'https://evil.example' },
    data: { sessionId: id, events: [] },
  })
  expect(push.status()).toBe(403)
})

test('the composer shows the model, cycles its thinking level, and remembers it', async ({
  page,
}) => {
  await stubDesktop(page)
  await page.goto('/v3')
  await createApp(page)
  const composer = page.getByRole('region', { name: 'Chat' })
  await expect(composer).toContainText('Gemini 3.8 Flash')
  const thinking = composer.getByRole('button', { name: /^Agent thinking: / })
  await expect(thinking).toHaveAccessibleName('Agent thinking: medium')
  await thinking.click()
  await expect(thinking).toHaveAccessibleName('Agent thinking: high')
  await thinking.click()
  await expect(thinking).toHaveAccessibleName('Agent thinking: low')
  await page.reload()
  await expect(thinking).toHaveAccessibleName('Agent thinking: low')
  await expect(composer.getByRole('button', { name: 'Send' })).toBeDisabled()
  await composer.getByRole('textbox', { name: 'Message' }).fill('Hi')
  await expect(composer.getByRole('button', { name: 'Send' })).toBeEnabled()
})

test('the screen pane opens on the app tab, empty until the agent shows one', async ({
  page,
}) => {
  await stubDesktop(page)
  await page.goto('/v3')
  await createApp(page)
  const tabs = page.getByRole('tablist', { name: 'Screen' })
  await expect(tabs.getByRole('tab')).toHaveText(['App', 'Computer'])
  await expect(tabs.getByRole('tab', { name: 'App' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('[data-app-placeholder]')).toContainText(
    'No app yet',
  )
  await expect(page.locator('iframe[title="App"]')).toHaveCount(0)
  await tabs.getByRole('tab', { name: 'Computer' }).click()
  await expect(tabs.getByRole('tab', { name: 'Computer' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // The desktop panel keeps its size while another tab is on top.
  const desktop = page.locator('section[aria-label="Desktop"]')
  expect((await desktop.boundingBox())!.width).toBeGreaterThan(300)
})

test('the desktop viewer keeps retrying when the connection fails', async ({
  page,
}) => {
  const desktop = await stubDesktop(page)
  await page.goto('/v3')
  await createApp(page)
  await expect(page.locator('section[aria-label="Desktop"]')).toHaveAttribute(
    'data-status',
    'reconnecting',
  )
  // Each retry asks the server again, which resumes a stopped desktop.
  await expect.poll(() => desktop.count, { timeout: 15000 }).toBeGreaterThan(2)
})

test('voice mode can read what the agent is doing', async ({ page }) => {
  await stubDesktop(page)
  const gateway = await mockGateway(page, '**/v3/api/realtime**')
  await page.goto('/v3')
  await createApp(page)
  await page.getByRole('button', { name: 'Voice mode', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  const session = gateway.sent.find((event) => event.type === 'session-update')!
    .config as any
  expect(session.tools.map((tool: { name: string }) => tool.name)).toEqual([
    'delegate',
    'agent_status',
  ])
  expect(session.providerOptions.google).not.toHaveProperty('thinkingConfig')
  expect(await gateway.call('agent_status', {})).toEqual({
    working: false,
    currentTask: null,
    stepsSoFar: 0,
    latestSteps: [],
    queuedTasks: 0,
    lastReply: null,
  })
})

test('the header switches between the examples', async ({ page }) => {
  await stubDesktop(page)
  await page.goto('/v3')
  await page.getByRole('button', { name: 'Example: v3' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText([
    /v1\s*Canvas/,
    /v2\s*Studio/,
    /v3\s*Computer/,
  ])
  await menu.getByRole('menuitem', { name: /v2/ }).click()
  await expect(page).toHaveURL(/\/v2/)
  await expect(page.getByRole('button', { name: 'Example: v2' })).toBeVisible()
})
