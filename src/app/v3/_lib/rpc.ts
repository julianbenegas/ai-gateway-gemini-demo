import { rpc, unwrap } from '@/lib/rpc'
import type { Api } from '../_server/api'

const api = rpc<Api>().v3.api
const app = (id: string) => api.apps({ id })

export const appsApi = {
  renameApp: ({ id, name }: { id: string; name: string }) =>
    unwrap(app(id).patch({ name })),
  deleteApp: ({ id }: { id: string }) => unwrap(app(id).delete()),
  openDesktop: ({ id }: { id: string }) => unwrap(app(id).desktop.post()),
}
