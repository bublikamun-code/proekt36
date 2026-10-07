import { computed, ref } from 'vue'

/** A press only becomes a drag once the pointer has clearly moved, so a tap still selects. */
const DRAG_THRESHOLD_PX = 4

export type BoardDragSource =
  | { kind: 'catalog'; id: string; width: number }
  | { kind: 'placed'; id: string; width: number; fromRow: number; fromSlot: number }

type Phase = 'idle' | 'pressed' | 'dragging'

interface Session {
  phase: Phase
  source: BoardDragSource | null
  pointerId: number
  x: number
  y: number
}

const session = ref<Session>({ phase: 'idle', source: null, pointerId: -1, x: 0, y: 0 })
let origin = { x: 0, y: 0 }
let swallowClick = false

export const isDragging = computed(() => session.value.phase === 'dragging')
export const dragPointer = computed(() => ({ x: session.value.x, y: session.value.y }))
export const dragSource = computed(() => session.value.source)

const isPrimary = (event: PointerEvent) => event.isPrimary !== false && (event.pointerType !== 'mouse' || event.button === 0)

let onCommit: (() => void) | null = null

/** Registers the board's drop handler. It runs while the session is still live. */
export const setBoardDropHandler = (handler: (() => void) | null) => { onCommit = handler }

const finish = (commit: boolean) => {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', abandon)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('blur', abandon)
  const wasDragging = session.value.phase === 'dragging'
  if (wasDragging && commit) onCommit?.()
  session.value = { phase: 'idle', source: null, pointerId: -1, x: 0, y: 0 }
  // The browser still fires a click on the common ancestor of the press and the
  // release, which would both place a catalogue item and select a device. One
  // swallowed click keeps a finished drag from having that side effect.
  if (wasDragging) {
    swallowClick = true
    window.setTimeout(() => { swallowClick = false }, 0)
  }
}

function onMove(event: PointerEvent) {
  if (event.pointerId !== session.value.pointerId) return
  session.value = { ...session.value, x: event.clientX, y: event.clientY }
  if (session.value.phase === 'pressed' && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRAG_THRESHOLD_PX) {
    session.value = { ...session.value, phase: 'dragging' }
  }
}

function onUp(event: PointerEvent) {
  if (event.pointerId !== session.value.pointerId) return
  session.value = { ...session.value, x: event.clientX, y: event.clientY }
  finish(true)
}

const abandon = () => finish(false)

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || session.value.phase !== 'dragging') return
  event.stopPropagation()
  finish(false)
}

/**
 * Starts a board drag from a pointer press, wherever that press happens. Pointer
 * tracking lives on the window rather than on a captured element, so a drag that
 * begins in the catalogue can travel across the whole page, and a touch or pen
 * behaves exactly like a mouse.
 */
export const beginBoardDrag = (source: BoardDragSource, event: PointerEvent) => {
  if (!isPrimary(event) || session.value.phase !== 'idle') return
  origin = { x: event.clientX, y: event.clientY }
  session.value = { phase: 'pressed', source, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', abandon)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', abandon)
}

/** Aborts a drag in progress without dropping anything. */
export const cancelBoardDrag = () => { if (session.value.phase !== 'idle') finish(false) }

if (typeof window !== 'undefined') {
  window.addEventListener('click', (event) => {
    if (!swallowClick) return
    event.stopPropagation()
    event.preventDefault()
  }, true)
}
