'use client'

import Link from 'next/link'
import { Menu } from '@base-ui/react/menu'
import { Asterisk, ChevronDown } from 'lucide-react'

const examples = [
  { name: 'v1', title: 'Canvas' },
  { name: 'v2', title: 'Studio' },
  { name: 'v3', title: 'Computer' },
]

/** The wordmark, then a menu that switches between the examples. */
export function Brand({ href, suffix }: { href: string; suffix?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[15px] leading-5 font-semibold tracking-tight uppercase">
      <Link href={href} className="group flex items-center gap-1.5 text-dim">
        <Asterisk size={18} strokeWidth={2.5} className="text-accent" />
        <span className="group-hover:text-bright group-hover:underline">
          Margin
        </span>
      </Link>
      {suffix && (
        <Menu.Root>
          <Menu.Trigger
            aria-label={`Example: ${suffix}`}
            className="group flex items-center gap-1 font-normal text-faint uppercase outline-none hover:text-bright focus-visible:text-bright data-popup-open:text-bright"
          >
            / {suffix}
            <ChevronDown
              size={13}
              className="transition-transform group-data-popup-open:rotate-180"
            />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={8} align="start" className="z-50">
              <Menu.Popup className="min-w-44 bg-shade py-1 shadow-lg shadow-black/40 outline-none">
                {examples.map((example) => (
                  <Menu.LinkItem
                    key={example.name}
                    render={<Link href={`/${example.name}`} />}
                    aria-current={example.name === suffix ? 'page' : undefined}
                    className="flex h-8 items-center gap-3 px-3 text-dim outline-none data-highlighted:bg-shade-hover data-highlighted:text-bright"
                  >
                    <span className="w-5 text-faint uppercase">
                      {example.name}
                    </span>
                    <span className="flex-1">{example.title}</span>
                    {example.name === suffix && (
                      <Asterisk size={12} className="text-accent" />
                    )}
                  </Menu.LinkItem>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  )
}
