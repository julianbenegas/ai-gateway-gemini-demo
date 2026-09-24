'use client'

import { useFormStatus } from 'react-dom'
import { Plus } from 'lucide-react'
import { Button, IconButton } from '@/ui/button'
import { createDesignAction } from '../_server/actions'

function Submit({ compact }: { compact?: boolean }) {
  const { pending } = useFormStatus()
  return compact ? (
    <IconButton
      label="New design"
      size="icon-sm"
      type="submit"
      disabled={pending}
    >
      <Plus size={14} />
    </IconButton>
  ) : (
    <Button variant="accent" type="submit" disabled={pending}>
      <Plus size={15} />
      New design
    </Button>
  )
}

export function NewDesign({ compact }: { compact?: boolean }) {
  return (
    <form action={createDesignAction}>
      <Submit compact={compact} />
    </form>
  )
}
