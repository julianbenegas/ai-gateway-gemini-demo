import { Check, LoaderCircle, X } from 'lucide-react'
import { IconButton } from './button'
import { cx } from './cx'

export type NoticeTone = 'error' | 'running' | 'done'

export function Notice({
  tone,
  children,
  action,
  onDismiss,
  className,
}: {
  tone: NoticeTone
  children: React.ReactNode
  action?: React.ReactNode
  onDismiss: () => void
  className?: string
}) {
  return (
    <div
      data-notice
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'z-10 flex w-max max-w-[min(420px,calc(100vw-32px))] items-center gap-2.5 bg-shade py-1 pr-1 pl-3 text-xs shadow-lg shadow-black/10',
        tone === 'error' && 'text-danger',
        className,
      )}
    >
      {tone === 'running' ? (
        <LoaderCircle size={13} className="shrink-0 animate-spin" />
      ) : tone === 'done' ? (
        <Check size={13} className="shrink-0 text-accent" />
      ) : null}
      <span className="leading-relaxed [overflow-wrap:anywhere]">
        {children}
      </span>
      {action}
      <IconButton
        label="Dismiss notification"
        size="icon-sm"
        onClick={onDismiss}
      >
        <X size={13} />
      </IconButton>
    </div>
  )
}
