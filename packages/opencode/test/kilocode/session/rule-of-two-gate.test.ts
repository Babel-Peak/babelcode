// kilocode_change - new file
// Verifies persistRuleOfTwoGate writes the gate onto the session RECORD
// (Session.Info.permission), not just Permission.Service's own in-memory
// per-session ruleset -- this is the seam a Task-tool-spawned subagent's
// deriveSubagentSessionPermission actually reads (Phase 6).

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../../src/bus"
import * as Config from "../../../src/config/config"
import { Session } from "../../../src/session/session"
import { persistRuleOfTwoGate } from "../../../src/kilocode/session/rule-of-two-gate"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = LayerNode.compile(
  LayerNode.group([Config.node, Session.node, SessionProjector.node, Bus.node, CrossSpawnSpawner.node]),
)
const it = testEffect(env)

const ADDITIONS = [
  { permission: "bash" as const, pattern: "*" as const, action: "deny" as const },
  { permission: "webfetch" as const, pattern: "*" as const, action: "deny" as const },
]

describe("persistRuleOfTwoGate", () => {
  it.live("adds the deny rules to a session with no prior permission overrides", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({})
          expect(session.permission ?? []).toEqual([])

          yield* persistRuleOfTwoGate(sessions, session.id, ADDITIONS)

          const refreshed = yield* sessions.get(session.id)
          expect(refreshed.permission).toEqual(expect.arrayContaining(ADDITIONS))
        }),
      { git: true },
    ),
  )

  it.live("preserves existing session permission overrides instead of replacing them", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({})
          const existing = [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]
          yield* sessions.setPermission({ sessionID: session.id, permission: existing })

          yield* persistRuleOfTwoGate(sessions, session.id, ADDITIONS)

          const refreshed = yield* sessions.get(session.id)
          expect(refreshed.permission).toEqual(expect.arrayContaining([...existing, ...ADDITIONS]))
        }),
      { git: true },
    ),
  )

  it.live("never fails the caller when the session doesn't exist", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const fakeSessionID = "ses_doesnotexist" as Session.Info["id"]
          yield* persistRuleOfTwoGate(sessions, fakeSessionID, ADDITIONS)
        }),
      { git: true },
    ),
  )
})
