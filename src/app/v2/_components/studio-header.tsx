import {
  CloudAlert,
  CloudCheck,
  CodeXml,
  Download,
  LoaderCircle,
  PanelLeft,
  Undo2,
} from 'lucide-react'
import { Brand } from '@/ui/brand'
import { IconButton } from '@/ui/button'

const statusIcons = {
  saving: { icon: LoaderCircle, label: 'Saving', className: 'animate-spin' },
  saved: { icon: CloudCheck, label: 'Saved', className: 'text-faint' },
  failed: { icon: CloudAlert, label: 'Not saved', className: 'text-danger' },
}

export function StudioHeader({
  designName,
  status,
  disabled,
  agentEdits,
  onUndoAgentEdit,
  onToggleSidebar,
  onViewSource,
  onDownload,
}: {
  designName?: string
  status: keyof typeof statusIcons | null
  disabled: boolean
  agentEdits: number
  onUndoAgentEdit: () => void
  onToggleSidebar: () => void
  onViewSource: () => void
  onDownload: () => void
}) {
  const Status = status && statusIcons[status]
  return (
    <header className="col-span-2 flex items-center gap-3 px-2">
      <IconButton label="Toggle designs" onClick={onToggleSidebar}>
        <PanelLeft size={16} />
      </IconButton>
      <Brand href="/v2" suffix="v2" />
      <span className="truncate text-faint max-sm:hidden">{designName}</span>
      <div className="ml-auto flex items-center gap-0.5">
        {Status && (
          <span
            role="status"
            title={Status.label}
            className="grid size-8 place-items-center"
          >
            <Status.icon size={14} className={Status.className} />
            <span className="sr-only">{Status.label}</span>
          </span>
        )}
        <IconButton
          label="Undo agent edit"
          onClick={onUndoAgentEdit}
          disabled={!agentEdits}
        >
          <Undo2 size={16} />
        </IconButton>
        <IconButton
          label="View website source"
          onClick={onViewSource}
          disabled={disabled}
        >
          <CodeXml size={16} />
        </IconButton>
        <IconButton
          label="Download website"
          onClick={onDownload}
          disabled={disabled}
        >
          <Download size={16} />
        </IconButton>
      </div>
    </header>
  )
}
