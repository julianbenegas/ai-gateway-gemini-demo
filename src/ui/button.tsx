import type { ComponentProps } from 'react'
import { cx } from './cx'

const variants = {
  primary: 'bg-accent text-white hover:bg-accent/90',
  accent: 'bg-accent/10 text-accent hover:bg-accent/20',
  ghost:
    'text-muted hover:bg-shade hover:text-bright aria-pressed:bg-shade aria-pressed:text-bright',
  danger: 'text-muted hover:bg-danger/10 hover:text-danger',
  toggle:
    'text-faint hover:bg-shade hover:text-bright aria-pressed:bg-accent/10 aria-pressed:text-accent',
}

const sizes = {
  sm: 'h-6 px-1.5 text-xs',
  md: 'h-7 px-2.5',
  lg: 'h-9 px-3',
  icon: 'size-7',
  'icon-sm': 'size-6',
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-colors disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}

export function IconButton({
  label,
  size = 'icon',
  ...props
}: Omit<ButtonProps, 'size'> & {
  label: string
  size?: 'icon' | 'icon-sm'
}) {
  return <Button aria-label={label} title={label} size={size} {...props} />
}
