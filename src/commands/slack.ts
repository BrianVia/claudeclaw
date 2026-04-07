import { ensureProjectClaudeMd, run, runUserMessage, compactCurrentSession } from "../runner";
import { getSettings, loadSettings } from "../config";
import { resetSession, peekSession } from "../sessions";
import { transcribeAudioToText } from "../whisper";
import { resolveSkillPrompt } from "../skills";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

// --- Slack API constants ---

const SLACK_API = "https://slack.com/api";
const MAX_TEXT_LENGTH = 4000; // Slack's block text limit

// --- Type interfaces ---

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
}

interface SlackFile {
  id: string;
  name: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
  filetype?: string;
  size?: number;
}

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string; // "im", "mpim", "channel", "group"
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
  event_ts?: string;
}

interface SlackAppMentionEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
  event_ts?: string;
}

interface SlackEnvelope {
  envelope_id: string;
  type: string; // "events_api", "slash_commands", "interactive"
  payload: any;
  retry_attempt?: number;
  retry_reason?: string;
  accepts_response_payload?: boolean;
}

interface SlackSlashCommand {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  trigger_id: string;
  response_url: string;
}

// --- Module state ---

let ws: WebSocket | null = null;
let running = true;
let slackDebug = false;
let botUserId: string | null = null;
let botUsername: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const userNameCache = new Map<string, string>();

// --- Debug ---

function debugLog(message: string): void {
  if (!slackDebug) return;
  console.log(`[Slack][debug] ${message}`);
}

// --- Slack Web API helper ---

async function slackApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slack API ${method}: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as T & { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API ${method}: ${data.error ?? "unknown error"}`);
  }

  return data;
}

// --- User info resolution ---

async function resolveUserName(token: string, userId: string): Promise<string> {
  const cached = userNameCache.get(userId);
  if (cached) return cached;

  try {
    const info = await slackApi<{ user: SlackUser }>(token, "users.info", { user: userId });
    const name = info.user.real_name || info.user.name || userId;
    userNameCache.set(userId, name);
    return name;
  } catch (err) {
    debugLog(`Failed to resolve user ${userId}: ${err}`);
    return userId;
  }
}

// --- Markdown → Slack mrkdwn conversion ---

function markdownToSlackMrkdwn(text: string): string {
  if (!text) return "";

  // Protect code blocks
  const codeBlocks: string[] = [];
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Protect inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_m, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Headers → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Bold **text** or __text__ → *text*
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");
  text = text.replace(/__(.+?)__/g, "*$1*");

  // Italic _text_ → _text_ (same in Slack)

  // Strikethrough ~~text~~ → ~text~
  text = text.replace(/~~(.+?)~~/g, "~$1~");

  // Links [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Restore inline code
  for (let i = 0; i < inlineCodes.length; i++) {
    text = text.replace(`\x00IC${i}\x00`, `\`${inlineCodes[i]}\``);
  }

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    text = text.replace(`\x00CB${i}\x00`, `\`\`\`${codeBlocks[i]}\`\`\``);
  }

  return text;
}

// --- Message sending ---

async function sendMessage(
  token: string,
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const normalized = text.replace(/\[react:[^\]\r\n]+\]/gi, "").trim();
  if (!normalized) return;

  const mrkdwn = markdownToSlackMrkdwn(normalized);

  // Chunk long messages
  for (let i = 0; i < mrkdwn.length; i += MAX_TEXT_LENGTH) {
    const chunk = mrkdwn.slice(i, i + MAX_TEXT_LENGTH);
    const body: Record<string, unknown> = {
      channel: channelId,
      text: chunk,
    };
    if (threadTs) body.thread_ts = threadTs;
    await slackApi(token, "chat.postMessage", body);
  }
}

async function sendMessageToUser(
  token: string,
  userId: string,
  text: string,
): Promise<void> {
  // Open a DM channel with the user
  const result = await slackApi<{ channel: { id: string } }>(
    token,
    "conversations.open",
    { users: userId },
  );
  await sendMessage(token, result.channel.id, text);
}

// --- Typing indicator ---

// Slack doesn't have a persistent typing API like Discord;
// but we can indicate "working" with a reaction that we later remove.
// We use 👀 (eyes) as a "processing" indicator, like openclaw does.
async function addReaction(
  token: string,
  channelId: string,
  timestamp: string,
  emoji: string,
): Promise<void> {
  await slackApi(token, "reactions.add", {
    channel: channelId,
    timestamp,
    name: emoji,
  }).catch(() => {});
}

async function removeReaction(
  token: string,
  channelId: string,
  timestamp: string,
  emoji: string,
): Promise<void> {
  await slackApi(token, "reactions.remove", {
    channel: channelId,
    timestamp,
    name: emoji,
  }).catch(() => {});
}

// --- Reaction directive extraction (same as discord.ts / telegram.ts) ---

function extractReactionDirective(text: string): { cleanedText: string; reactionEmoji: string | null } {
  let reactionEmoji: string | null = null;
  const cleanedText = text
    .replace(/\[react:([^\]\r\n]+)\]/gi, (_match, raw) => {
      const candidate = String(raw).trim();
      if (!reactionEmoji && candidate) reactionEmoji = candidate;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanedText, reactionEmoji };
}

// --- File/attachment handling ---

function isImageFile(file: SlackFile): boolean {
  return Boolean(file.mimetype?.startsWith("image/"));
}

function isAudioFile(file: SlackFile): boolean {
  return Boolean(file.mimetype?.startsWith("audio/"));
}

async function downloadSlackFile(
  token: string,
  file: SlackFile,
  type: "image" | "voice",
): Promise<string | null> {
  const url = file.url_private_download || file.url_private;
  if (!url) return null;

  const dir = join(process.cwd(), ".claude", "claudeclaw", "inbox", "slack");
  await mkdir(dir, { recursive: true });

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Slack file download failed: ${response.status}`);

  const ext = extname(file.name) || (type === "voice" ? ".ogg" : ".jpg");
  const filename = `${file.id}-${Date.now()}${ext}`;
  const localPath = join(dir, filename);

  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  debugLog(`File downloaded: ${localPath} (${bytes.length} bytes)`);
  return localPath;
}

// --- Slash command handling ---

async function handleSlashCommand(
  token: string,
  command: SlackSlashCommand,
): Promise<void> {
  const config = getSettings().slack;

  // Authorization check
  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(command.user_id)) {
    await respondToSlashCommand(command.response_url, "Unauthorized.");
    return;
  }

  const cmdName = command.command.replace(/^\//, "");

  if (cmdName === "reset") {
    await resetSession();
    await respondToSlashCommand(command.response_url, "Session reset. Next message starts fresh.");
    return;
  }

  if (cmdName === "compact") {
    await respondToSlashCommand(command.response_url, "Compacting session...");
    const result = await compactCurrentSession();
    await respondToSlashCommand(command.response_url, result.message);
    return;
  }

  if (cmdName === "status") {
    const session = await peekSession();
    const settings = getSettings();
    if (!session) {
      await respondToSlashCommand(command.response_url, "No active session.");
      return;
    }
    const lines = [
      "*Session Status*",
      `Session: \`${session.sessionId.slice(0, 8)}\``,
      `Turns: ${(session as any).turnCount ?? 0}`,
      `Model: ${settings.model || "default"}`,
      `Security: ${settings.security.level}`,
      `Created: ${session.createdAt}`,
    ];
    await respondToSlashCommand(command.response_url, lines.join("\n"));
    return;
  }

  // Default: treat as a prompt to Claude
  if (command.text?.trim()) {
    await respondToSlashCommand(command.response_url, "Processing...");
    const result = await runUserMessage("slack", `[Slack /${cmdName}] ${command.text}`);
    if (result.exitCode === 0) {
      await sendMessage(token, command.channel_id, result.stdout || "(empty response)");
    } else {
      await sendMessage(token, command.channel_id, `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown"}`);
    }
  }
}

async function respondToSlashCommand(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, response_type: "ephemeral" }),
  }).catch((err) => {
    console.error(`[Slack] Failed to respond to slash command: ${err}`);
  });
}

// --- Message handler ---

async function handleMessage(
  token: string,
  event: SlackMessageEvent | SlackAppMentionEvent,
): Promise<void> {
  const config = getSettings().slack;

  // Ignore bot messages and message_changed/deleted subtypes
  if ("subtype" in event && event.subtype) return;
  if ("bot_id" in event && event.bot_id) return;

  const userId = event.user;
  if (!userId) return;

  // Ignore our own messages
  if (botUserId && userId === botUserId) return;

  const channelId = event.channel;
  const text = event.text ?? "";
  const ts = event.ts ?? "";
  const threadTs = "thread_ts" in event ? event.thread_ts : undefined;

  if (!channelId) return;

  // Determine if this is a DM or channel message
  const isDm = "channel_type" in event && (event.channel_type === "im" || event.channel_type === "mpim");
  const isAppMention = event.type === "app_mention";

  // In channels: only respond to mentions, listen channels, or thread replies we're in
  if (!isDm && !isAppMention) {
    const isListenChannel = config.listenChannels.includes(channelId);
    if (!isListenChannel) return;
  }

  // Authorization check
  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
    if (isDm) {
      await sendMessage(token, channelId, "Unauthorized.", threadTs || ts);
    }
    debugLog(`Skip message from unauthorized user ${userId}`);
    return;
  }

  // Clean content — strip bot mention
  let cleanContent = text;
  if (botUserId) {
    cleanContent = cleanContent.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
  }

  // Detect files
  const files = "files" in event ? (event.files ?? []) : [];
  const imageFiles = files.filter(isImageFile);
  const audioFiles = files.filter(isAudioFile);
  const hasImage = imageFiles.length > 0;
  const hasAudio = audioFiles.length > 0;

  if (!cleanContent.trim() && !hasImage && !hasAudio) return;

  const userName = await resolveUserName(token, userId);
  const mediaParts = [hasImage ? "image" : "", hasAudio ? "voice" : ""].filter(Boolean);
  const mediaSuffix = mediaParts.length > 0 ? ` [${mediaParts.join("+")}]` : "";
  console.log(
    `[${new Date().toLocaleTimeString()}] Slack ${userName}${mediaSuffix}: "${cleanContent.slice(0, 60)}${cleanContent.length > 60 ? "..." : ""}"`,
  );

  // Processing indicator
  await addReaction(token, channelId, ts, "eyes");

  try {
    let imagePath: string | null = null;
    let audioPath: string | null = null;
    let voiceTranscript: string | null = null;

    if (hasImage) {
      try {
        imagePath = await downloadSlackFile(token, imageFiles[0], "image");
      } catch (err) {
        console.error(`[Slack] Failed to download image: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (hasAudio) {
      try {
        audioPath = await downloadSlackFile(token, audioFiles[0], "voice");
      } catch (err) {
        console.error(`[Slack] Failed to download audio: ${err instanceof Error ? err.message : err}`);
      }

      if (audioPath) {
        try {
          voiceTranscript = await transcribeAudioToText(audioPath, {
            debug: slackDebug,
            log: (msg) => debugLog(msg),
          });
        } catch (err) {
          console.error(`[Slack] Failed to transcribe audio: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // Skill routing
    const command = cleanContent.startsWith("/") ? cleanContent.trim().split(/\s+/, 1)[0].toLowerCase() : null;
    let skillContext: string | null = null;
    if (command) {
      try {
        skillContext = await resolveSkillPrompt(command);
        if (skillContext) {
          debugLog(`Skill resolved for ${command}: ${skillContext.length} chars`);
        }
      } catch (err) {
        debugLog(`Skill resolution failed for ${command}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Build prompt
    const promptParts = [`[Slack from ${userName}]`];
    if (skillContext) {
      const args = cleanContent.trim().slice(command!.length).trim();
      promptParts.push(`<command-name>${command}</command-name>`);
      promptParts.push(skillContext);
      if (args) promptParts.push(`User arguments: ${args}`);
    } else if (cleanContent.trim()) {
      promptParts.push(`Message: ${cleanContent}`);
    }
    if (imagePath) {
      promptParts.push(`Image path: ${imagePath}`);
      promptParts.push("The user attached an image. Inspect this image file directly before answering.");
    } else if (hasImage) {
      promptParts.push("The user attached an image, but downloading it failed. Respond and ask them to resend.");
    }
    if (voiceTranscript) {
      promptParts.push(`Voice transcript: ${voiceTranscript}`);
      promptParts.push("The user attached voice audio. Use the transcript as their spoken message.");
    } else if (hasAudio) {
      promptParts.push(
        "The user attached voice audio, but it could not be transcribed. Respond and ask them to resend a clearer clip.",
      );
    }

    const prefixedPrompt = promptParts.join("\n");
    const result = await runUserMessage("slack", prefixedPrompt);

    // Remove processing indicator, add completion indicator
    await removeReaction(token, channelId, ts, "eyes");

    if (result.exitCode !== 0) {
      await addReaction(token, channelId, ts, "x");
      await sendMessage(
        token,
        channelId,
        `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`,
        threadTs || ts,
      );
    } else {
      const { cleanedText, reactionEmoji } = extractReactionDirective(result.stdout || "");

      if (reactionEmoji) {
        // Map common unicode emoji to Slack shortcodes
        const emojiName = mapEmojiToSlackName(reactionEmoji);
        if (emojiName) {
          await addReaction(token, channelId, ts, emojiName);
        }
      } else {
        await addReaction(token, channelId, ts, "white_check_mark");
      }

      // Reply in thread: use the original message ts as thread_ts
      await sendMessage(token, channelId, cleanedText || "(empty response)", threadTs || ts);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Slack] Error for ${userName}: ${errMsg}`);
    await removeReaction(token, channelId, ts, "eyes");
    await addReaction(token, channelId, ts, "x");
    await sendMessage(token, channelId, `Error: ${errMsg}`, threadTs || ts);
  }
}

// Common emoji → Slack shortcode mapping
function mapEmojiToSlackName(emoji: string): string | null {
  const map: Record<string, string> = {
    "👍": "thumbsup",
    "👎": "thumbsdown",
    "❤️": "heart",
    "😂": "joy",
    "🎉": "tada",
    "🔥": "fire",
    "✅": "white_check_mark",
    "❌": "x",
    "👀": "eyes",
    "🤔": "thinking_face",
    "💯": "100",
    "🙏": "pray",
    "⭐": "star",
    "🚀": "rocket",
  };
  // If it's already a shortcode name (no emoji characters), use directly
  if (/^[a-z0-9_+-]+$/.test(emoji)) return emoji;
  return map[emoji] ?? null;
}

// --- Socket Mode connection ---

async function getSocketModeUrl(appToken: string): Promise<string> {
  const data = await slackApi<{ url: string }>(appToken, "apps.connections.open");
  return data.url;
}

function acknowledgeEnvelope(envelopeId: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ envelope_id: envelopeId }));
    debugLog(`Acknowledged envelope: ${envelopeId}`);
  }
}

async function handleEnvelope(botToken: string, envelope: SlackEnvelope): Promise<void> {
  // Always acknowledge immediately to prevent retries
  acknowledgeEnvelope(envelope.envelope_id);

  switch (envelope.type) {
    case "events_api": {
      const event = envelope.payload?.event;
      if (!event) return;

      debugLog(`Event: ${event.type} subtype=${event.subtype ?? "none"} channel=${event.channel}`);

      if (event.type === "message" || event.type === "app_mention") {
        handleMessage(botToken, event).catch((err) =>
          console.error(`[Slack] Message handler error:`, err),
        );
      }
      break;
    }

    case "slash_commands": {
      const command = envelope.payload as SlackSlashCommand;
      debugLog(`Slash command: ${command.command} from ${command.user_name}`);
      handleSlashCommand(botToken, command).catch((err) =>
        console.error(`[Slack] Slash command error:`, err),
      );
      break;
    }

    case "interactive": {
      // Future: handle interactive components (buttons, etc.)
      debugLog(`Interactive event received (not handled)`);
      break;
    }

    default:
      debugLog(`Unknown envelope type: ${envelope.type}`);
  }
}

async function fetchBotIdentity(botToken: string): Promise<void> {
  try {
    const data = await slackApi<{ user_id: string; user: string; team_id: string; team: string }>(
      botToken,
      "auth.test",
    );
    botUserId = data.user_id;
    botUsername = data.user;
    console.log(`[Slack] Authenticated as ${data.user} (${data.user_id}) in team ${data.team}`);
  } catch (err) {
    console.error(`[Slack] Failed to fetch bot identity: ${err}`);
  }
}

async function connectSocketMode(botToken: string, appToken: string): Promise<void> {
  if (!running) return;

  try {
    const wsUrl = await getSocketModeUrl(appToken);
    debugLog(`Connecting to Socket Mode: ${wsUrl.slice(0, 60)}...`);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      debugLog("Socket Mode WebSocket opened");
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));

        if (data.type === "hello") {
          console.log("[Slack] Socket Mode connected");
          return;
        }

        if (data.type === "disconnect") {
          debugLog(`Disconnect requested: reason=${data.reason}`);
          // Slack asks us to reconnect — close and let onclose handler reconnect
          ws?.close(1000, "Disconnect requested by Slack");
          return;
        }

        // All other messages are envelopes
        if (data.envelope_id) {
          handleEnvelope(botToken, data as SlackEnvelope).catch((err) =>
            console.error(`[Slack] Envelope handler error:`, err),
          );
        }
      } catch (err) {
        console.error(`[Slack] Failed to parse Socket Mode message: ${err}`);
      }
    };

    ws.onclose = (event) => {
      debugLog(`Socket Mode closed: code=${event.code} reason=${event.reason}`);
      if (!running) return;

      reconnectAttempts++;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.error(`[Slack] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
        return;
      }

      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000) + Math.random() * 1000;
      console.log(`[Slack] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(() => connectSocketMode(botToken, appToken), delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  } catch (err) {
    console.error(`[Slack] Failed to establish Socket Mode connection: ${err}`);
    if (!running) return;

    reconnectAttempts++;
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
      console.log(`[Slack] Retrying in ${Math.round(delay / 1000)}s...`);
      setTimeout(() => connectSocketMode(botToken, appToken), delay);
    }
  }
}

// --- Exports ---

/** Send a message to a specific channel (used by heartbeat forwarding) */
export { sendMessage, sendMessageToUser };

/** Stop Socket Mode connection and clear runtime state. */
export function stopSocketMode(): void {
  running = false;
  if (ws) {
    try {
      ws.close(1000, "Socket Mode stop requested");
    } catch {
      // best-effort
    }
    ws = null;
  }
  botUserId = null;
  botUsername = null;
  reconnectAttempts = 0;
  userNameCache.clear();
}

process.on("SIGTERM", () => {
  stopSocketMode();
});
process.on("SIGINT", () => {
  stopSocketMode();
});

/** Start Socket Mode connection in-process (called by start.ts when token is configured) */
export function startSocketMode(debug = false): void {
  slackDebug = debug;
  const config = getSettings().slack;
  if (ws) stopSocketMode();
  running = true;

  console.log("Slack bot started (Socket Mode)");
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (config.listenChannels.length > 0) {
    console.log(`  Listen channels: ${config.listenChannels.join(", ")}`);
  }
  if (slackDebug) console.log("  Debug: enabled");

  (async () => {
    await ensureProjectClaudeMd();
    await fetchBotIdentity(config.botToken);
    await connectSocketMode(config.botToken, config.appToken);
  })().catch((err) => {
    console.error(`[Slack] Fatal: ${err}`);
  });
}

/** Standalone entry point (bun run src/index.ts slack) */
export async function slack() {
  await loadSettings();
  await ensureProjectClaudeMd();
  const config = getSettings().slack;

  if (!config.botToken) {
    console.error("Slack bot token not configured. Set slack.botToken in .claude/claudeclaw/settings.json");
    process.exit(1);
  }
  if (!config.appToken) {
    console.error("Slack app token not configured. Set slack.appToken in .claude/claudeclaw/settings.json");
    process.exit(1);
  }

  console.log("Slack bot started (Socket Mode, standalone)");
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (slackDebug) console.log("  Debug: enabled");

  await fetchBotIdentity(config.botToken);
  await connectSocketMode(config.botToken, config.appToken);

  // Keep process alive
  await new Promise(() => {});
}
