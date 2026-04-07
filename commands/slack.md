---
description: Show Slack bot status and manage global session
---

Show the Slack bot integration status. Check the following:

1. **Configuration**: Read `.claude/claudeclaw/settings.json` and check if `slack.botToken` and `slack.appToken` are set (show masked tokens: first 5 chars + "..."). Show `allowedUserIds` and `listenChannels`.

2. **Global Session**: Read `.claude/claudeclaw/session.json` and show:
   - Session UUID (first 8 chars)
   - Created at
   - Last used at
   - Note: This session is shared across heartbeat, cron jobs, Telegram, Discord, and Slack messages.

3. **If $ARGUMENTS contains "clear"**: Delete `.claude/claudeclaw/session.json` to reset the global session. Confirm to the user. The next run from any source (heartbeat, cron, Telegram, Discord, or Slack) will create a fresh session.

4. **Running**: Check if the daemon is running by reading `.claude/claudeclaw/daemon.pid`. The Slack bot runs in-process with the daemon when both tokens are configured.

5. **Setup guide** (if tokens not configured): Explain how to set up a Slack app:
   - Go to https://api.slack.com/apps → Create New App → From scratch
   - Enable Socket Mode (Settings → Socket Mode → Enable)
   - Create an App-Level Token with `connections:write` scope → save as `slack.appToken`
   - Add Bot Token Scopes (OAuth & Permissions): `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `im:write`, `reactions:read`, `reactions:write`, `users:read`
   - Enable Events (Event Subscriptions → Enable → Subscribe to bot events): `app_mention`, `message.channels`, `message.groups`, `message.im`
   - Install to workspace → copy Bot User OAuth Token → save as `slack.botToken`
   - Optionally add `slack.allowedUserIds` and `slack.listenChannels`

Format the output clearly for the user.
