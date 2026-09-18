// kilocode_change - new file
// Persists a Rule-of-Two gate (permission/index.ts's Permission.observeToolResult)
// onto the session record itself (Session.Info.permission), not just
// Permission.Service's own in-memory per-session ruleset (state.session,
// used by ask()/resolve()). Those are two separate stores -- a Task-tool-
// spawned subagent's deriveSubagentSessionPermission reads the parent
// Session record, not Permission.Service's internals, so without this the
// gate would silently not reach any subagent spawned from a gated session.
// Permission.Service can't persist this itself: Session already depends on
// Permission (session.ts imports Permission for other rulesets), so the
// reverse dependency would be circular.
import { Effect } from "effect"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { Ruleset } from "@/permission"

export function persistRuleOfTwoGate(
  sessions: Session.Interface,
  sessionID: SessionID,
  additions: Ruleset,
): Effect.Effect<void> {
  return sessions.get(sessionID).pipe(
    Effect.flatMap((session) =>
      sessions.setPermission({ sessionID, permission: [...(session.permission ?? []), ...additions] }),
    ),
    // Never let a persistence hiccup fail the tool call the gate was reacting to.
    Effect.catch(() => Effect.void),
  )
}
