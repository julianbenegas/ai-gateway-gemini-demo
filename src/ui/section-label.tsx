export function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-8 items-center gap-2 text-xs font-medium text-faint uppercase">
      <span>{children}</span>
      <span className="dashed-line flex-1" />
      {action}
    </div>
  )
}
