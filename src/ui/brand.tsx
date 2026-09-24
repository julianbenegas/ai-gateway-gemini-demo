import { Asterisk } from 'lucide-react'

export function Brand({ href, suffix }: { href: string; suffix?: string }) {
  return (
    <a
      href={href}
      className="group flex items-center gap-1.5 text-[15px] leading-5 font-semibold tracking-tight text-dim uppercase"
    >
      <Asterisk size={18} strokeWidth={2.5} className="text-accent" />
      <span className="group-hover:text-bright group-hover:underline">
        Margin
      </span>
      {suffix && <span className="font-normal text-faint">/ {suffix}</span>}
    </a>
  )
}
