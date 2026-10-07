import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** Viewport gestures affect the view only; apparatus placement remains a separate command. */
export const useBoardViewport = (options: {
  canvas: Ref<HTMLElement | null>
  svg: Ref<SVGSVGElement | null>
  active: () => boolean
  panTool: () => boolean
  zoom: () => number
  setZoom: (value: number) => void
}) => {
  const spaceHeld = ref(false)
  const isPanning = ref(false)
  const canPan = computed(() => options.panTool() || spaceHeld.value)
  let pan: { pointerId: number; x: number; y: number; left: number; top: number } | null = null
  let swallowClick = false
  let clickTimer = 0

  const stopPan = () => {
    const element = options.canvas.value
    if (pan && element?.hasPointerCapture(pan.pointerId)) element.releasePointerCapture(pan.pointerId)
    pan = null
    isPanning.value = false
    window.removeEventListener('pointermove', movePan)
    window.removeEventListener('pointerup', endPan)
    window.removeEventListener('pointercancel', endPan)
    if (swallowClick) {
      window.clearTimeout(clickTimer)
      clickTimer = window.setTimeout(() => { swallowClick = false }, 0)
    }
  }
  const movePan = (event: PointerEvent) => {
    const element = options.canvas.value
    if (!pan || !element || event.pointerId !== pan.pointerId) return
    event.preventDefault()
    element.scrollLeft = pan.left - (event.clientX - pan.x)
    element.scrollTop = pan.top - (event.clientY - pan.y)
  }
  const endPan = (event: PointerEvent) => {
    if (event.pointerId === pan?.pointerId) stopPan()
  }
  const startPan = (event: PointerEvent) => {
    const element = options.canvas.value
    if (!element || !options.active() || !event.isPrimary || pan) return
    if (event.button !== 1 && !(event.button === 0 && canPan.value)) return
    event.preventDefault()
    event.stopPropagation()
    element.focus({ preventScroll: true })
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }
    isPanning.value = true
    swallowClick = true
    element.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', movePan, { passive: false })
    window.addEventListener('pointerup', endPan)
    window.addEventListener('pointercancel', endPan)
  }
  const guardCanvasClick = (event: MouseEvent) => {
    if (!swallowClick && !canPan.value) return
    event.preventDefault()
    event.stopPropagation()
  }
  const editable = (target: EventTarget | null) => target instanceof HTMLElement
    && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName))
  const keyDown = (event: KeyboardEvent) => {
    if (!options.active() || editable(event.target)) return
    if (event.code === 'Space' && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey
      && event.target instanceof Node && options.canvas.value?.contains(event.target)) {
      event.preventDefault()
      spaceHeld.value = true
    }
    if (event.key === 'Escape') reset()
  }
  const keyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') spaceHeld.value = false
  }
  const reset = () => { spaceHeld.value = false; stopPan() }

  const onCanvasWheel = async (event: WheelEvent) => {
    if (!options.active() || (!event.ctrlKey && !event.metaKey)) return
    event.preventDefault()
    const element = options.canvas.value
    const svg = options.svg.value
    const matrix = svg?.getScreenCTM()
    if (!element || !svg || !matrix || !event.deltaY) return
    const before = options.zoom()
    const after = Math.min(2.5, Math.max(0.5, Math.round((before - Math.sign(event.deltaY) * 0.1) * 10) / 10))
    if (after === before) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    options.setZoom(after)
    await nextTick()
    if (!options.active()) return
    const nextMatrix = svg.getScreenCTM()
    if (!nextMatrix) return
    const position = point.matrixTransform(nextMatrix)
    element.scrollLeft += position.x - event.clientX
    element.scrollTop += position.y - event.clientY
  }
  const fitView = async () => {
    reset()
    options.setZoom(1)
    await nextTick()
    options.canvas.value?.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }

  watch(options.active, reset)
  onMounted(() => {
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', reset)
  })
  onBeforeUnmount(() => {
    reset()
    window.clearTimeout(clickTimer)
    window.removeEventListener('keydown', keyDown)
    window.removeEventListener('keyup', keyUp)
    window.removeEventListener('blur', reset)
  })
  return { isPanning, canPan, startPan, stopPan, guardCanvasClick, onCanvasWheel, fitView }
}
