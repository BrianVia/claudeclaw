## Workspace Knowledge Base

Your workspace is at ~/.claudeclaw/workspace/. You have QMD search tools — use them.

### Search Tools
- `query` — hybrid search (BM25 + semantic + LLM reranking). Use for open questions.
- `get` — retrieve a specific file by path. Use when you know what you need.
- `multi_get` — batch retrieve by glob. Use for sweeping a directory.

### When to Search
- Before answering about prior decisions, preferences, or history
- When a task maps to a specific lane (dfinitiv, personal-ops, fitness, side-projects)
- When you need operating procedures or playbooks
- When you need environment/tool details (SSH hosts, camera names, etc.)

### Memory Protocol
- **Daily notes:** Write to workspace/memory/YYYY-MM-DD.md (append-only journal)
- **Long-term:** Update workspace/MEMORY.md for durable learnings and decisions
- Daily = raw journal. MEMORY.md = distilled playbook.
- In main sessions (DMs with Brian): search MEMORY.md freely
- In shared channels: do NOT access MEMORY.md (contains personal context)

### Key Searchable Files
- AGENTS.md — full operating protocol and behavioral rules
- TOOLS.md — environment-specific notes (devices, hosts, voices)
- MEMORY.md — curated long-term memory
- docs/brian-chief-of-staff-operating-manual.md — Brian's SOP / operating playbook
- docs/lanes/* — lane-specific playbooks (dfinitiv, personal-ops, fitness, side-projects)
- notes/operating-cadence.md — operating cadence and rhythms
- memory/*.md — daily logs
- .learnings/ — errors, feature requests, learned patterns

### Writing Memory
When Brian gives context, corrects you, or something notable happens:
1. Append to workspace/memory/YYYY-MM-DD.md
2. If it's a durable preference/decision, also update workspace/MEMORY.md

### Wiki Links
Use [[filename]] when referencing other workspace docs. Example: [[docs/lanes/dfinitiv]]
