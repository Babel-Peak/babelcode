import { Show } from "solid-js"
import { BasicTool as Base, GenericTool } from "@opencode-ai/ui/basic-tool"
import type { BasicToolProps as BaseProps, TriggerTitle } from "@opencode-ai/ui/basic-tool"
import { toolOpenKey, readToolOpen, writeToolOpen } from "./tool-open-state"
import { useToolApproval, ToolApprovalLine } from "./tool-approval"

export { GenericTool }
export type { TriggerTitle }

export interface BasicToolProps extends BaseProps {
  tool?: string
  callID?: string
  partID?: string
  approvalPlacement?: "body" | "hidden"
}

type OpenProps = Pick<BasicToolProps, "tool" | "callID" | "partID" | "forceOpen" | "defaultOpen">

export function initialOpen(props: OpenProps) {
  return props.forceOpen ? true : readToolOpen(toolOpenKey(props), props.defaultOpen)
}

export function useToolApprovalLine() {
  const approval = useToolApproval()
  return () => {
    const value = approval()
    return value ? <ToolApprovalLine display={value} /> : null
  }
}

/**
 * Whether BasicTool should inject the approval line into its body.
 */
export function shouldRenderApprovalInBody(placement: BasicToolProps["approvalPlacement"], hasApproval: boolean) {
  return placement !== "hidden" && hasApproval
}

export function BasicTool(props: BasicToolProps) {
  const key = () => toolOpenKey(props)
  const initial = () => initialOpen(props)
  const approval = useToolApproval()
  const inBody = () => shouldRenderApprovalInBody(props.approvalPlacement, approval() !== undefined)
  const change = (open: boolean) => {
    writeToolOpen(key(), open)
    props.onOpenChange?.(open)
  }
  // Renders after the body/tool list, not before — it's context about what
  // happened, not part of the header.
  const details = () => (
    <div data-slot="basic-tool-details">
      {props.children}
      <Show when={inBody() && approval()}>{(value) => <ToolApprovalLine display={value()} />}</Show>
    </div>
  )
  // A <Show>, not a plain `if`: inBody() tracks the visibility toggle, which can
  // flip after mount (Settings), so the branch must stay reactive.
  // Default every tool card to the smooth JS-driven
  // height animation Base already implements (packages/ui/basic-tool.tsx's
  // `animated` prop, via the `motion` library's spring). Upstream's CSS
  // fallback path (collapsible.css's slideDown/slideUp keyframes) is
  // commented out there, so without this every tool card snapped open/closed
  // instantly. Deferred effects mean this never animates the initial reveal
  // of tool cards that start open (e.g. bash's always-open default) --
  // it only smooths a viewer's own later clicks -- so this is safe even when
  // many tool calls render in a single burst. Individual call sites can still
  // opt out with an explicit `animated={false}`.
  const animated = () => props.animated ?? true
  return (
    <Show
      when={"children" in props || inBody()}
      fallback={
        <Base {...props} animated={animated()} defaultOpen={initial()} retainDetails={props.defer} onOpenChange={change} />
      }
    >
      <Base
        {...props}
        animated={animated()}
        defaultOpen={initial()}
        retainDetails={props.defer}
        onOpenChange={change}
        hasDetails={inBody()}
      >
        {details()}
      </Base>
    </Show>
  )
}
