# ClaudeClaw System Prompt Anatomy

What Claude sees on every invocation, in order:

```
┌─────────────────────────────────────────────────────┐
│                --append-system-prompt                │
│                                                     │
│  1. "You are running inside ClaudeClaw."            │
│                                                     │
│  2. IDENTITY.md (~300B)                             │
│     └─ Agent name, creature type, vibe, emoji       │
│     └─ Source: ~/.claudeclaw/prompts/IDENTITY.md    │
│        fallback: ~/claudeclaw/prompts/IDENTITY.md   │
│                                                     │
│  3. USER.md (~6KB)                                  │
│     └─ Brian's full profile: family, work, goals,   │
│        schedule, fitness, preferences, finances      │
│     └─ Source: ~/.claudeclaw/prompts/USER.md        │
│        fallback: ~/claudeclaw/prompts/USER.md       │
│                                                     │
│  4. SOUL.md (~13KB)                                 │
│     └─ Behavioral guidelines, tone, boundaries,     │
│        core truths, vibe, emoji rules, continuity    │
│     └─ Source: ~/.claudeclaw/prompts/SOUL.md        │
│        fallback: ~/claudeclaw/prompts/SOUL.md       │
│                                                     │
│  5. WORKSPACE.md (~1.5KB)                    [NEW]  │
│     └─ QMD search instructions, memory protocol,    │
│        key files reference, wiki link convention     │
│     └─ Source: ~/.claudeclaw/prompts/WORKSPACE.md   │
│        fallback: ~/claudeclaw/prompts/WORKSPACE.md  │
│                                                     │
│  6. CLAUDE.md (~4.5KB)                              │
│     └─ Project CLAUDE.md from repo root             │
│     └─ Agent persona, managed blocks                │
│     └─ Source: ~/claudeclaw/CLAUDE.md               │
│                                                     │
│  7. DIR_SCOPE_PROMPT (~200B)                        │
│     └─ Security constraint: scoped to project dir   │
│        + workspace dir                              │
│     └─ Only added when security != "unrestricted"   │
│                                                     │
├─────────────────────────────────────────────────────┤
│                   User Message                      │
│                                                     │
│  [clock prefix]                                     │
│  [2026-04-08 08:15:32 UTC-4]                        │
│                                                     │
│  [Slack from Brian Via]                             │
│  Message: hey what do you know about me?            │
│                                                     │
├─────────────────────────────────────────────────────┤
│              Available Tools                        │
│                                                     │
│  From Claude Code:                                  │
│    Read, Write, Edit, Glob, Grep, Bash,             │
│    WebSearch, WebFetch (varies by security level)   │
│                                                     │
│  From QMD MCP (.mcp.json):                   [NEW]  │
│    query    - hybrid search across workspace        │
│    get      - retrieve specific file                │
│    multi_get - batch retrieve by glob               │
│    status   - index health info                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│         NOT loaded (searchable via QMD)             │
│                                                     │
│  AGENTS.md (~10KB) - operating protocol             │
│  MEMORY.md (~1.5KB) - long-term curated memory      │
│  TOOLS.md (~20KB) - environment notes               │
│  docs/lanes/* - lane playbooks                      │
│  memory/*.md - daily logs                           │
│  notes/ - general notes                             │
│  .learnings/ - error/feature/learning logs          │
└─────────────────────────────────────────────────────┘

## Prompt Size Budget

| Component        | Size    | Loaded |
|------------------|---------|--------|
| Header           | ~50B    | Always |
| IDENTITY.md      | ~300B   | Always |
| USER.md          | ~6KB    | Always |
| SOUL.md          | ~13KB   | Always |
| WORKSPACE.md     | ~1.5KB  | Always |
| CLAUDE.md        | ~4.5KB  | Always |
| DIR_SCOPE_PROMPT | ~200B   | Unless unrestricted |
| **Total**        | **~26KB** | |

## Load Priority (user override > repo default)

For each prompt file, ClaudeClaw checks:
1. ~/.claudeclaw/prompts/{FILE}.md (user override)
2. ~/claudeclaw/prompts/{FILE}.md (repo default)

First file found with content wins.

## Security Levels & Tool Access

| Level        | Tools                          |
|--------------|-------------------------------|
| locked       | Read, Grep, Glob only          |
| strict       | All except Bash, WebSearch, WebFetch |
| moderate     | All tools, scoped to project + workspace dirs |
| unrestricted | All tools, no restrictions      |
