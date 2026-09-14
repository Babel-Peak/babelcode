/** @jsxImportSource solid-js */
/**
 * Horizontal session activity timeline rendered as color-grouped SVG paths.
 * Pointer and keyboard interaction use the same pure bar geometry.
 */

import { Component, For, Show, createMemo, createEffect, createSignal, on, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import { useSession } from "../../context/session"
import { visibleParts } from "../../context/session-queue"
import { color, label, palette } from "../../utils/timeline/colors"
import { geometry, hit, navigate, spanIndex } from "../../utils/timeline/geometry"
import { dispatchTimelineHighlight, same, type TimelineHighlight } from "../../utils/timeline/highlight"
import { onTimelineViewport, type TimelineViewport } from "../../utils/timeline/viewport"
import { sizes, pinned, INDICATOR_GAP, INDICATOR_H, MAX_HEIGHT, TIMELINE_HEIGHT } from "../../utils/timeline/sizes"
import { isRenderable } from "../../utils/transcript-parts"
import type { Part, Message, TextPart } from "../../types/messages"

export interface TimelineBar {
  bg: string
  tip: string
  width: number
  height: number
  idx: number
  msgId: string
  partId: string
}

/** User queries render as their own bar, highlighted in the user color. */
function userParts(msg: Message, getParts: (id: string) => Part[]): Part[] {
  const text = getParts(msg.id).find((part): part is TextPart => part.type === "text" && !part.synthetic)
  if (!text) return []
  return [{ ...text, id: `${msg.id}:query`, messageID: msg.id }]
}

function collect(messages: Message[], parts: Record<string, Part[]>, getParts: (id: string) => Part[]): TimelineBar[] {
  const result: { msg: Message; part: Part; user: boolean }[] = []

  for (const msg of messages) {
    if (msg.role === "user") {
      const ps = userParts(msg, getParts)
      for (const p of ps) result.push({ msg, part: p, user: true })
      continue
    }
    const ps = parts[msg.id]
    if (!ps) continue
    for (const p of ps) {
      if (p.type === "step-start") continue
      result.push({ msg, part: p, user: false })
    }
  }

  const sz = sizes(result.map((item) => item.part))
  return result.map((item, i) => ({
    bg: item.user ? palette.user : color(item.part),
    tip: item.user ? "User query" : label(item.part, item.msg),
    width: sz[i]!.width,
    height: sz[i]!.height,
    idx: i,
    msgId: item.msg.id,
    partId: item.part.id,
  }))
}

export const TaskTimeline: Component = () => {
  const session = useSession()
  let ref: HTMLDivElement | undefined
  let dragging = false
  let dragMoved = false
  let startX = 0
  let startScroll = 0
  const [hover, setHover] = createSignal(-1)
  const [active, setActive] = createSignal(-1)
  const [tip, setTip] = createSignal<{ text: string; x: number; y: number }>()

  const messages = () => session.visibleMessages()
  const allParts = () => {
    const msgs = messages()
    const revert = session.revert() ?? undefined
    const qs = session.questions()
    const result: Record<string, Part[]> = {}
    for (const m of msgs) {
      if (m.role === "user") continue
      const p = visibleParts(m.id, session.getParts(m.id), revert).filter((part) => {
        if (!isRenderable(part as SDKPart, m as SDKAssistantMessage)) return false
        if (part.type !== "tool" || part.tool !== "question") return true
        if (part.state.status !== "pending" && part.state.status !== "running") return true
        const call = (part as SDKPart & { callID: string }).callID
        return qs.some((item) => item.tool?.callID === call && item.tool?.messageID === m.id)
      })
      if (p.length > 0) result[m.id] = p
    }
    return result
  }

  const bars = createMemo(() => collect(messages(), allParts(), session.getParts))
  const layout = createMemo(() => geometry(bars(), MAX_HEIGHT))
  const busy = () => session.status() === "busy"

  // Chat viewport span, dispatched by MessageList on scroll, drawn as a line
  // under the bars so scrolling visibly tracks "where am I" in the actions.
  const [viewport, setViewport] = createSignal<TimelineViewport>()
  onCleanup(onTimelineViewport(setViewport))
  const span = createMemo(() => {
    const view = viewport()
    const list = bars()
    const items = layout().items
    if (!view || list.length === 0 || items.length === 0) return undefined
    const order = new Map<string, number>()
    messages().forEach((msg, i) => order.set(msg.id, i))
    const start = spanIndex(list, order, view.first, true)
    const end = spanIndex(list, order, view.last, false)
    if (start < 0 || end < 0) return undefined
    const from = items[Math.min(start, end)]!
    const to = items[Math.max(start, end)]!
    return { x: from.x, width: to.x + to.width - from.x }
  })
  const selected = () => {
    const idx = active()
    if (idx >= 0 && idx < bars().length) return idx
    return bars().length - 1
  }
  const aria = () => {
    const idx = selected()
    const bar = bars()[idx]
    if (!bar) return "No activity"
    return `Bar ${idx + 1} of ${bars().length}: ${bar.tip}`
  }
  const value = () => Math.max(0, selected() + 1)

  let prev = 0
  let frame: number | undefined
  let follow = true
  const onScroll = () => {
    if (ref) follow = pinned(ref)
  }
  createEffect(
    on(
      () => bars().length,
      (len) => {
        if (active() >= len) setActive(len - 1)
        if (len > prev && ref && follow && frame === undefined) {
          frame = requestAnimationFrame(() => {
            frame = undefined
            if (!ref || !follow) return
            ref.scrollLeft = ref.scrollWidth
          })
        }
        prev = len
      },
    ),
  )
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  const hideTip = () => {
    setHover(-1)
    setTip(undefined)
  }

  createEffect(
    on(
      bars,
      (next, previous) => {
        const idx = hover()
        if (idx < 0 || same(previous?.[idx], next[idx])) return
        hideTip()
      },
      { defer: true },
    ),
  )

  // Highlight the chat part behind the hovered/focused bar, using its own
  // color, so it's easy to follow which bar belongs to which tool call.
  createEffect<TimelineHighlight | undefined>((previous) => {
    const idx = hover()
    const bar = idx >= 0 ? bars()[idx] : undefined
    const next = bar ? { msgId: bar.msgId, partId: bar.partId } : undefined
    if (same(previous, next)) return previous
    dispatchTimelineHighlight(next)
    return next
  })
  onCleanup(() => dispatchTimelineHighlight(undefined))

  const showTip = (idx: number) => {
    const item = layout().items[idx]
    const bar = bars()[idx]
    if (!ref || !item || !bar) return hideTip()
    const rect = ref.getBoundingClientRect()
    const margin = Math.min(160, window.innerWidth / 2)
    setHover(idx)
    setTip({
      text: bar.tip,
      x: Math.max(margin, Math.min(window.innerWidth - margin, rect.left + item.x - ref.scrollLeft + item.width / 2)),
      y: rect.top + MAX_HEIGHT - item.height,
    })
  }

  const pointerIndex = (e: PointerEvent) => {
    if (!ref) return -1
    const rect = ref.getBoundingClientRect()
    return hit(layout().items, e.clientX - rect.left + ref.scrollLeft)
  }

  const onPointerDown = (e: PointerEvent) => {
    hideTip()
    if (!ref) return
    dragging = true
    dragMoved = false
    startX = e.clientX
    startScroll = ref.scrollLeft
    ref.setPointerCapture(e.pointerId)
    ref.style.cursor = "grabbing"
    ref.style.userSelect = "none"
  }

  const select = (idx: number) => {
    const bar = bars()[idx]
    if (!bar) return
    setActive(idx)
    window.dispatchEvent(new CustomEvent("scrollToMessage", { detail: { id: bar.msgId, partId: bar.partId } }))
    showTip(idx)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!ref) return
    if (!dragging) {
      const idx = pointerIndex(e)
      if (idx === hover()) return
      if (idx < 0) return hideTip()
      return showTip(idx)
    }
    if (Math.abs(e.clientX - startX) > 3) dragMoved = true
    ref.scrollLeft = startScroll - (e.clientX - startX)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!ref) return
    const wasDragging = dragging
    dragging = false
    if (ref.hasPointerCapture(e.pointerId)) ref.releasePointerCapture(e.pointerId)
    ref.style.cursor = "grab"
    ref.style.userSelect = ""
    if (!wasDragging || dragMoved) return
    const idx = pointerIndex(e)
    select(idx)
  }

  const onWheel = (e: WheelEvent) => {
    hideTip()
    if (!ref) return
    e.preventDefault()
    ref.scrollLeft += e.deltaY || e.deltaX
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      select(selected())
      return
    }
    if (!ref || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
    const idx = navigate(selected(), bars().length, e.key)
    setActive(idx)
    const item = layout().items[idx]
    if (!item) return
    const left = item.x
    const right = item.x + item.width
    if (left < ref.scrollLeft) ref.scrollLeft = left
    if (right > ref.scrollLeft + ref.clientWidth) ref.scrollLeft = right - ref.clientWidth
    showTip(idx)
  }

  createEffect(() => {
    const el = ref
    if (!el) return
    el.addEventListener("wheel", onWheel, { passive: false })
    onCleanup(() => el.removeEventListener("wheel", onWheel))
  })

  const overlay = (idx: number, pulse = false) => {
    const item = layout().items[idx]
    if (!item) return null
    return (
      <div
        class="task-timeline-bar"
        classList={{ "task-timeline-bar--active": pulse }}
        aria-hidden="true"
        style={{
          left: `${item.x}px`,
          width: `${item.width}px`,
          height: `${item.height}px`,
          "--timeline-color": item.bg,
        }}
      />
    )
  }

  return (
    <>
      <div class="task-timeline-outer">
        <div
          ref={ref}
          class="task-timeline"
          data-timeline-count={bars().length}
          role="slider"
          tabIndex={0}
          aria-label="Session activity timeline"
          aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Space"
          aria-valuemin={bars().length > 0 ? 1 : 0}
          aria-valuemax={bars().length}
          aria-valuenow={value()}
          aria-valuetext={aria()}
          style={{ height: `${TIMELINE_HEIGHT}px` }}
          onKeyDown={onKeyDown}
          onBlur={hideTip}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={hideTip}
          onScroll={onScroll}
        >
          <div class="task-timeline-content" style={{ width: `${layout().width}px`, height: `${MAX_HEIGHT}px` }}>
            <svg
              class="task-timeline-svg"
              width={layout().width}
              height={MAX_HEIGHT}
              viewBox={`0 0 ${layout().width} ${MAX_HEIGHT}`}
              aria-hidden="true"
            >
              <For each={layout().paths}>{(path) => <path d={path.d} fill={path.bg} />}</For>
            </svg>
            <Show when={hover() >= 0}>{overlay(hover())}</Show>
            <Show when={busy() && bars().length > 0}>{overlay(bars().length - 1, true)}</Show>
            <Show when={span()}>
              {(s) => (
                <div
                  class="task-timeline-viewport"
                  aria-hidden="true"
                  style={{
                    left: `${s().x}px`,
                    width: `${s().width}px`,
                    top: `${MAX_HEIGHT + INDICATOR_GAP}px`,
                    height: `${INDICATOR_H}px`,
                  }}
                />
              )}
            </Show>
          </div>
        </div>
      </div>
      <Show when={tip()}>
        {(current) => (
          <Portal>
            <div
              data-component="tooltip"
              class="task-timeline-tooltip"
              role="tooltip"
              style={{ left: `${current().x}px`, top: `${current().y}px` }}
            >
              {current().text}
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
