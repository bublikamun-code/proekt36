import { readonly, ref } from 'vue'

export interface ConfirmRequest {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Highlights the confirming action as destructive. */
  danger?: boolean
}

type ConfirmState = Required<Omit<ConfirmRequest, 'description'>> & { open: boolean; description: string }

/**
 * One app-wide confirmation dialog, so no view has to fall back on the native
 * `window.confirm` that renders outside the product's own styling.
 */
const state = ref<ConfirmState>({
  open: false,
  title: '',
  description: '',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  danger: false,
})

let settle: ((result: boolean) => void) | null = null

export const confirmAction = (request: ConfirmRequest) => new Promise<boolean>((resolve) => {
  // A second request supersedes the first: the older question is answered "no"
  // so a caller can never hang on a dialog that is no longer on screen.
  settle?.(false)
  state.value = { ...state.value, ...request, description: request.description ?? '', open: true }
  settle = resolve
})

export const resolveConfirm = (result: boolean) => {
  const answer = settle
  settle = null
  state.value = { ...state.value, open: false }
  answer?.(result)
}

export const useConfirm = () => ({ confirm: confirmAction, confirmState: readonly(state) })
