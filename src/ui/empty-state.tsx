import { Asterisk } from 'lucide-react'

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Asterisk size={28} strokeWidth={2.5} className="text-accent" />
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-dim uppercase">{title}</p>
        {children && <p className="text-faint">{children}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
