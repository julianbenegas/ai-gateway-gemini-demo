import { rpc } from '@/lib/rpc'
import type { Api } from '../_server/api'

export const api = rpc<Api>().v1.api
