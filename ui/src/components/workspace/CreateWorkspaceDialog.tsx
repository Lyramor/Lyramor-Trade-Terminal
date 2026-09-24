/**
 * Modal presentation of `CreateWorkspaceForm`. The sidebar quick-create
 * (Workspaces activity) and the Chat section's `+` both render this — a
 * popup with room to grow, instead of cramming fields into the sidebar.
 *
 * The form owns all create logic; this only supplies the modal chrome and
 * closes itself on success.
 */

import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '../uta/Dialog'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'
import type { TemplateInfo, Workspace } from './api'

export interface CreateWorkspaceDialogProps {
  readonly templates: readonly TemplateInfo[]
  /** Pin the template (Chat section). Omit for the general sidebar create. */
  readonly presetTemplate?: string
  /** Seed the tag input (e.g. the Chat section's date-based default). */
  readonly initialTag?: string
  readonly onCreated: (workspace: Workspace) => void
  readonly onClose: () => void
}

export function CreateWorkspaceDialog(props: CreateWorkspaceDialogProps): ReactElement {
  const { t } = useTranslation()
  // `w-full` di telepon: `w-[460px]` cuma dijepit `max-w-[95vw]` milik Dialog,
  // dan 95vw masih lebih lebar dari ruang yang tersisa setelah padding
  // backdrop, jadi tepinya kepotong.
  return (
    <Dialog onClose={props.onClose} width="w-full sm:w-[460px]">
      <div className="shrink-0 px-5 py-4 border-b border-border">
        <h2 className="text-[15px] font-semibold text-text">{t('createWorkspace.dialogTitle')}</h2>
        <p className="text-[12px] text-text-muted mt-0.5">
          {t('createWorkspace.dialogSubtitle')}
        </p>
      </div>
      {/* Dialog memasang `max-h-[85dvh]` + `overflow-hidden`, jadi badan
          formnya yang harus menggulir. Tanpa `min-h-0` di flex column, isinya
          malah terpotong dan tombol Create tidak kejangkau. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <CreateWorkspaceForm
          templates={props.templates}
          presetTemplate={props.presetTemplate}
          initialTag={props.initialTag}
          autoFocusTag
          onCancel={props.onClose}
          onCreated={(workspace) => {
            props.onCreated(workspace)
            props.onClose()
          }}
        />
      </div>
    </Dialog>
  )
}
