# OpenClaw Review

This note captures what is worth borrowing from `/Users/via/openclaw` for ClaudeClaw, and what should stay out.

## Summary

OpenClaw is much broader than ClaudeClaw. The useful move is not to copy the product; it is to copy a few architectural boundaries:

- isolate scheduled work from chat sessions
- introduce a small channel adapter boundary
- replace raw allowlists with pairing/approval flows
- add a `doctor` command with runtime health checks
- separate onboarding/setup concerns from steady-state runtime code

ClaudeClaw should not import OpenClaw's full plugin platform, giant config surface, or multi-channel product scope.

## Current ClaudeClaw Shape

ClaudeClaw is still a compact daemon with:

- a single runtime entrypoint in [src/index.ts](/Users/via/claudeclaw/src/index.ts)
- central Claude invocation/session logic in [src/runner.ts](/Users/via/claudeclaw/src/runner.ts)
- one global session plus Discord-thread-specific sessions in [src/sessions.ts](/Users/via/claudeclaw/src/sessions.ts) and [src/sessionManager.ts](/Users/via/claudeclaw/src/sessionManager.ts)
- channel implementations as large command modules in [src/commands/telegram.ts](/Users/via/claudeclaw/src/commands/telegram.ts), [src/commands/discord.ts](/Users/via/claudeclaw/src/commands/discord.ts), and [src/commands/slack.ts](/Users/via/claudeclaw/src/commands/slack.ts)
- a light dashboard state model in [src/ui/services/state.ts](/Users/via/claudeclaw/src/ui/services/state.ts)

That is a good baseline. The main issue is that runtime boundaries are still implicit.

## Copy Now

### 1. Isolated heartbeat and cron sessions

This is the highest-value change.

Right now ClaudeClaw heartbeats and cron jobs run through the same resumable session machinery used by normal chat:

- [src/commands/start.ts](/Users/via/claudeclaw/src/commands/start.ts#L661)
- [src/commands/start.ts](/Users/via/claudeclaw/src/commands/start.ts#L814)
- [src/runner.ts](/Users/via/claudeclaw/src/runner.ts#L396)

OpenClaw explicitly defaults scheduled `agentTurn` work to isolated sessions to avoid long-lived context pollution and token buildup:

- [src/cron/normalize.ts](/Users/via/openclaw/src/cron/normalize.ts#L527)

Recommendation:

- add a separate session target for heartbeat and job runs
- default automation to isolated sessions
- keep delivery separate from session choice

### 2. A minimal channel adapter registry

OpenClaw's full plugin system is too much, but its channel boundary is right:

- registry loading/caching in [src/channels/plugins/registry.ts](/Users/via/openclaw/src/channels/plugins/registry.ts#L40)
- shared channel types in [src/channels/plugins/types.core.ts](/Users/via/openclaw/src/channels/plugins/types.core.ts#L70)

ClaudeClaw currently duplicates channel concerns across large files:

- auth checks
- mention/listen routing
- attachment handling
- formatting
- status reporting

Recommendation:

- define a small internal `ChannelAdapter` interface
- move shared behaviors into common helpers
- keep Telegram/Discord/Slack as built-in adapters, not external plugins

### 3. General session scoping instead of Discord-only thread logic

ClaudeClaw has a useful but narrow thread-session implementation:

- [src/sessionManager.ts](/Users/via/claudeclaw/src/sessionManager.ts#L34)

OpenClaw has a more general session key model that separates direct-chat continuity from group isolation:

- [src/config/sessions/session-key.ts](/Users/via/openclaw/src/config/sessions/session-key.ts#L29)

Recommendation:

- generalize session identity to `channel + conversation target`
- treat Discord threads, Slack threads, and Telegram topics as variants of the same concept
- keep the current storage simple; just change the key model

### 4. Pairing instead of raw allowlists

ClaudeClaw currently gates access with static `allowedUserIds` and returns `"Unauthorized."`:

- [src/commands/telegram.ts](/Users/via/claudeclaw/src/commands/telegram.ts#L596)
- [src/commands/discord.ts](/Users/via/claudeclaw/src/commands/discord.ts#L467)
- [src/commands/slack.ts](/Users/via/claudeclaw/src/commands/slack.ts#L488)

OpenClaw's pairing flow is a better operational model:

- shared pairing challenge flow in [src/pairing/pairing-challenge.ts](/Users/via/openclaw/src/pairing/pairing-challenge.ts#L20)
- durable pairing/allowlist store in [src/pairing/pairing-store.ts](/Users/via/openclaw/src/pairing/pairing-store.ts#L63)

Recommendation:

- keep explicit allowlists as an advanced option
- default new DM access to a lightweight pairing flow
- store approvals per channel identity

### 5. A real `doctor` command

ClaudeClaw has `status`, but not a stronger diagnosis flow. OpenClaw's health model is worth copying:

- channel/gateway checks in [src/commands/doctor-gateway-health.ts](/Users/via/openclaw/src/commands/doctor-gateway-health.ts#L17)

ClaudeClaw's dashboard state currently only reports a narrow slice of runtime state:

- [src/ui/services/state.ts](/Users/via/claudeclaw/src/ui/services/state.ts#L24)

Recommendation:

- add `claudeclaw doctor`
- verify bot auth/config for each enabled channel
- flag risky security settings
- flag stale sessions and failed automation runs

### 6. Pull setup/onboarding out of runtime flow

OpenClaw keeps setup as a first-class config-shaping concern:

- workspace defaults in [src/commands/onboard-config.ts](/Users/via/openclaw/src/commands/onboard-config.ts#L8)
- wizard/session/workspace prep in [src/commands/onboard-helpers.ts](/Users/via/openclaw/src/commands/onboard-helpers.ts#L168)

ClaudeClaw can benefit from a smaller version of that:

- a setup command that validates tokens, security, web UI, and workspace
- less setup logic living inside the daemon loop

### 7. Adapter contract tests

Once ClaudeClaw has an adapter boundary, add contract-style tests like OpenClaw's:

- [src/channels/plugins/contracts/setup.registry-backed.contract.test.ts](/Users/via/openclaw/src/channels/plugins/contracts/setup.registry-backed.contract.test.ts#L1)

Recommendation:

- test every adapter against the same auth/trigger/status contract
- use the contract tests to stop channel regressions as features expand

## Do Not Copy

Do not copy these parts directly:

- the full plugin SDK and runtime loader stack
- the huge config schema surface
- the multi-channel product ambition
- the giant test/config matrix
- OpenClaw's broader gateway/platform concepts

ClaudeClaw gets its value from being smaller, more opinionated, and easier to operate.

## Suggested Sequence

Implement in this order:

1. isolated sessions for heartbeats and cron jobs
2. minimal internal channel adapter interface
3. `doctor` command and richer health/status model
4. pairing flow for DM authorization
5. generalized session scoping across channel conversation types
6. setup/onboarding cleanup
7. adapter contract tests

## Practical Rule

Borrow OpenClaw's seams, not its size.
