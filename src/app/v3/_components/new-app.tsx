'use client'

import { useFormStatus } from 'react-dom'
import { Plus } from 'lucide-react'
import { Button, IconButton } from '@/ui/button'
import { createAppAction } from '../_server/actions'

function Submit({ compact }: { compact?: boolean }) {
  const { pending } = useFormStatus()
  return compact ? (
    <IconButton label="New app" size="icon-sm" type="submit" disabled={pending}>
      <Plus size={14} />
    </IconButton>
  ) : (
    <Button variant="accent" type="submit" disabled={pending}>
      <Plus size={15} />
      New app
    </Button>
  )
}

export function NewApp({ compact }: { compact?: boolean }) {
  return (
    <form action={createAppAction}>
      <Submit compact={compact} />
    </form>
  )
}
