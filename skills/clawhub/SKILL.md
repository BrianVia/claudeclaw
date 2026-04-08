---
name: clawhub
description: Search and install skills from ClawHub (clawhub.ai), the skill registry for AI agents. Use when users ask to find skills on clawhub, install from clawhub, browse clawhub, search clawhub, add a clawhub skill, or want new capabilities from the clawhub marketplace. Trigger phrases include "clawhub", "claw hub", "install from clawhub", "clawhub search", "clawhub install", "skill registry", "skill marketplace".
---

# ClawHub

Search and install skills from [ClawHub](https://clawhub.ai) into the global skills directory (`~/.claude/skills/`). Installed skills become immediately available as `/slash-commands` in all sessions.

## Scripts

Two scripts are provided in this skill's directory:

### Search: `search.mjs`

```bash
node ${SKILL_DIR}/search.mjs "<query>"
```

Returns JSON array of matching skills:
```json
[{"slug": "skill-name", "displayName": "Skill Name", "summary": "...", "downloads": 1234, "version": "1.0.0"}]
```

### Install: `install.mjs`

```bash
node ${SKILL_DIR}/install.mjs <slug> [target-dir]
```

Downloads the latest version from ClawHub and extracts to `<target-dir>/<slug>/` (defaults to `~/.claude/skills/<slug>/`). Returns:
```json
{"ok": true, "slug": "skill-name", "version": "1.0.0", "path": "/full/path", "files": ["SKILL.md", ...]}
```

## Workflow

1. If the user gives a specific skill slug, skip to step 3.

2. **Search**: Run `search.mjs` with the user's query. Show the top results as a numbered list with name, summary, and download count. Ask which one they want.

3. **Install**: Run `install.mjs` with the chosen slug.

4. **Confirm**: Show what was installed — skill name, version, files downloaded, and mention it's now available as `/<slug>`.

Replace `${SKILL_DIR}` with the actual path to this skill's directory when running the scripts.
