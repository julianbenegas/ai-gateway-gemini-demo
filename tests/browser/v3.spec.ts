import { expect, type Page, test } from '@playwright/test'

// The desktop is a real Vercel Sandbox; these tests stand in a blank page.
async function stubDesktop(page: Page) {
  await page.route('**/v3/api/apps/*/desktop', (route) =>
    route.fulfill({ json: { url: 'about:blank' } }),
  )
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
  await expect(page.locator('iframe[title="Desktop"]')).toHaveAttribute(
    'src',
    'about:blank',
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
