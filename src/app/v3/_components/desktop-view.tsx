'use client'

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type RFB from '@novnc/novnc'
import { appsApi } from '../_lib/rpc'

const KEEP_ALIVE_MS = 4 * 60 * 1000
const MAX_RETRY_MS = 10_000

type Status = 'starting' | 'connected' | 'reconnecting'

/**
 * The app's desktop over VNC, drawn by noVNC's client alone. The screen
 * resizes to fit this panel. When the connection drops, as when the sandbox
 * stopped, it asks the server again, which resumes the desktop, and
 * reconnects; while open, it keeps the sandbox from stopping.
 */
export function DesktopView({ appId }: { appId: string }) {
  const screen = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('starting')
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let closed = false
    let rfb: RFB | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const reconnect = () => {
      if (closed) return
      clearTimeout(retry)
      retry = setTimeout(connect, Math.min(MAX_RETRY_MS, 500 * 2 ** attempts++))
    }
    const connect = async () => {
      clearTimeout(retry)
      try {
        const [{ url }, { default: RFB }] = await Promise.all([
          appsApi.openDesktop({ id: appId }),
          import('@novnc/novnc'),
        ])
        if (closed || !screen.current) return
        rfb?.disconnect()
        const session = new RFB(screen.current, url, { shared: true })
        session.resizeSession = true
        session.scaleViewport = true
        session.background = 'transparent'
        session.addEventListener('connect', () => {
          attempts = 0
          setFailure(null)
          setStatus('connected')
        })
        session.addEventListener('disconnect', () => {
          if (closed || rfb !== session) return
          rfb = null
          setStatus('reconnecting')
          reconnect()
        })
        rfb = session
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error))
        setStatus('reconnecting')
        reconnect()
      }
    }
    // A laptop waking up or a tab coming back retries right away.
    const resume = () => {
      if (document.visibilityState === 'visible' && !rfb) void connect()
    }
    void connect()
    const keepAlive = setInterval(
      () => void appsApi.openDesktop({ id: appId }).catch(() => {}),
      KEEP_ALIVE_MS,
    )
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(keepAlive)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      rfb?.disconnect()
    }
  }, [appId])

  return (
    <section
      aria-label="Desktop"
      data-status={status}
      className="relative min-h-0 min-w-0 p-3 pl-0"
    >
      <div ref={screen} className="size-full overflow-hidden bg-shade" />
      {status !== 'connected' && (
        <div className="absolute inset-3 left-0 grid place-items-center bg-shade/90">
          <div className="flex max-w-80 flex-col items-center gap-2 text-center">
            <p className="flex items-center gap-2 text-faint">
              <LoaderCircle size={14} className="animate-spin" />
              {status === 'starting'
                ? 'Starting the desktop'
                : 'Reconnecting to the desktop'}
            </p>
            {failure && <p className="text-xs text-danger">{failure}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
