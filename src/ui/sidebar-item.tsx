'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { Asterisk } from 'lucide-react'
import { cx } from './cx'
import { Menu, type MenuItem } from './menu'

/** A sidebar entry. Clicking the current entry renames it in place. */
/**
 * A sidebar entry. Other entries open with `href` (a link) or `onOpen`;
 * clicking the current entry renames it in place. Right-click opens a menu
 * with Rename and any `actions`.
 */
export function SidebarItem({
  name,
  current,
  href,
  onOpen,
  onRename,
  actions = [],
}: {
  name: string
  current: boolean
  href?: string
  onOpen?: () => void
  onRename: (name: string) => void
  actions?: MenuItem[]
}) {
  const [editing, setEditing] = useState(false)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenuAt(null), [])
  const cancelled = useRef(false)
  const rename = () => {
    cancelled.current = false
    setEditing(true)
  }
  const menuProps = {
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault()
      setMenuAt({ x: event.clientX, y: event.clientY })
    },
  }
  const menu = menuAt && (
    <Menu
      at={menuAt}
      items={[{ label: 'Rename', onSelect: rename }, ...actions]}
      onClose={closeMenu}
    />
  )
  const icon = (
    <Asterisk
      size={14}
      className={cx('shrink-0', current ? 'text-accent' : 'text-faint')}
    />
  )
  if (editing)
    return (
      <div className="flex h-7 shrink-0 items-center gap-1">
        {icon}
        <input
          aria-label={`Rename ${name}`}
          defaultValue={name}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            setEditing(false)
            const next = event.currentTarget.value.trim()
            if (!cancelled.current && next && next !== name) onRename(next)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              cancelled.current = true
              event.currentTarget.blur()
            }
          }}
          className="h-6 min-w-0 flex-1 bg-accent/5 px-1 text-accent outline-2 -outline-offset-1 outline-accent outline-dashed"
        />
      </div>
    )
  const className = cx(
    'group flex h-7 shrink-0 items-center gap-1 text-left',
    current ? 'text-bright' : 'text-dim',
  )
  const label = (
    <span className="truncate group-hover:underline max-sm:pr-2">{name}</span>
  )
  if (href && !current)
    return (
      <>
        <Link href={href} className={className} {...menuProps}>
          {icon}
          {label}
        </Link>
        {menu}
      </>
    )
  return (
    <>
      <button
        aria-current={current ? 'page' : undefined}
        onClick={() => (current ? rename() : onOpen?.())}
        className={className}
        {...menuProps}
      >
        {icon}
        {label}
      </button>
      {menu}
    </>
  )
}
