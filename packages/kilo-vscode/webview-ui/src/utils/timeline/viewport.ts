/**
 * Cross-component signal describing which transcript messages are currently
 * visible in the chat viewport. MessageList dispatches on scroll and layout
 * changes; TaskTimeline consumes it to draw the viewport indicator line under
 * the activity bars (same window-event convention as `timelineHighlight` and
 * `scrollToMessage` — no direct props/context link between the components).
 */

export interface TimelineViewport {
  /** Message id of the first visible transcript row. */
  first: string
  /** Message id of the last visible transcript row. */
  last: string
}

const EVENT = "timelineViewport"

export function dispatchTimelineViewport(value: TimelineViewport | undefined) {
  window.dispatchEvent(new CustomEvent<TimelineViewport | undefined>(EVENT, { detail: value }))
}

/** Registers a listener and returns an unregister function for onCleanup. */
export function onTimelineViewport(handler: (value: TimelineViewport | undefined) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<TimelineViewport | undefined>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
