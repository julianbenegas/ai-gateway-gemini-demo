import 'server-only'
import { randomBytes } from 'node:crypto'
import { HttpError } from '@/lib/api'
import { redis } from '@/lib/redis'
import { type ServerTool, serverTools } from '../_lib/tools'

/**
 * A voice session's authority to act on one design. The model's tool calls
 * run in the browser with the user's cookie, so the API can't tell them apart
 * from the user. The grant makes agent calls explicit, scoped, and revocable.
 */
export type Grant = {
  owner: string
  designId: string
  tools: readonly ServerTool[]
}

// Gateway's longest realtime session.
const GRANT_SECONDS = 25 * 60
const grantKey = (token: string) => `margin:v2:grant:${token}`

export async function issueGrant({
  owner,
  designId,
}: {
  owner: string
  designId: string
}) {
  const token = randomBytes(32).toString('base64url')
  const grant: Grant = { owner, designId, tools: serverTools }
  await redis().set(grantKey(token), grant, { ex: GRANT_SECONDS })
  return { grant: token, expiresIn: GRANT_SECONDS }
}

const bearer = (authorization: string | undefined) =>
  authorization?.match(/^Bearer ([\w-]{20,})$/)?.[1]

/**
 * The grant behind an `Authorization: Bearer` header, checked for a tool. It
 * must also belong to the browser's owner cookie, so a leaked grant alone
 * can't edit anything.
 */
export async function authorizeAgent({
  authorization,
  tool,
  owner,
}: {
  authorization: string | undefined
  tool: ServerTool
  owner: string | null
}) {
  const token = bearer(authorization)
  const grant = token && (await redis().get<Grant>(grantKey(token)))
  if (!grant)
    throw new HttpError({
      message:
        'The voice session has ended. Start voice again to keep editing.',
      status: 401,
    })
  if (grant.owner !== owner || !grant.tools.includes(tool))
    throw new HttpError({
      message: `This voice session cannot use ${tool}.`,
      status: 403,
    })
  return grant
}

export async function revokeGrant({
  authorization,
}: {
  authorization: string | undefined
}) {
  const token = bearer(authorization)
  if (token) await redis().del(grantKey(token))
}
