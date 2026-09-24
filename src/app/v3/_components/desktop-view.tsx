'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/ui/button'
import { appsApi } from '../_lib/rpc'

/** The app's sandbox desktop over noVNC; booting it takes a few seconds. */
export function DesktopView({ appId }: { appId: string }) {
  const [viewer, setViewer] = useState<
    { url: string } | { error: string } | null
  >(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setViewer(null)
    appsApi
      .openDesktop({ id: appId })
      .then(({ url }) => current && setViewer({ url }))
      .catch(
        (error) =>
          current &&
          setViewer({
            error: error instanceof Error ? error.message : String(error),
          }),
      )
    return () => {
      current = false
    }
  }, [appId, attempt])

  return (
    <section
      aria-label="Desktop"
      className="relative grid min-h-0 min-w-0 place-items-center p-3 pl-0"
    >
      {viewer && 'url' in viewer ? (
        <iframe
          title="Desktop"
          src={viewer.url}
          className="aspect-[16/10] max-h-full w-full bg-black"
        />
      ) : viewer ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p role="alert" className="max-w-80 text-danger">
            {viewer.error}
          </p>
          <Button variant="accent" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-faint">
          <LoaderCircle size={14} className="animate-spin" />
          Starting the desktop
        </p>
      )}
    </section>
  )
}
