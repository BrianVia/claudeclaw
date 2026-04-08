import { writeFile, unlink, readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { getPidPath, cleanupPidFile } from "../pid";
import { DATA_DIR, STATE_FILE } from "../paths";

const CLAUDE_DIR = join(process.cwd(), ".claude");
const STATUSLINE_FILE = join(CLAUDE_DIR, "statusline.cjs");
const CLAUDE_SETTINGS_FILE = join(CLAUDE_DIR, "settings.json");

async function teardownStatusline() {
  try {
    const settings = await Bun.file(CLAUDE_SETTINGS_FILE).json();
    delete settings.statusLine;
    await writeFile(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
  } catch {
    // file doesn't exist, nothing to clean up
  }

  try {
    await unlink(STATUSLINE_FILE);
  } catch {
    // already gone
  }
}

export async function stop() {
  const pidFile = getPidPath();
  let pid: string;
  try {
    pid = (await Bun.file(pidFile).text()).trim();
  } catch {
    console.log("No daemon is running (PID file not found).");
    process.exit(0);
  }

  try {
    process.kill(Number(pid), "SIGTERM");
    console.log(`Stopped daemon (PID ${pid}).`);
  } catch {
    console.log(`Daemon process ${pid} already dead.`);
  }

  await cleanupPidFile();
  await teardownStatusline();

  try {
    await unlink(STATE_FILE);
  } catch {
    // already gone
  }

  process.exit(0);
}

export async function stopAll() {
  // With central data dir, there's only one daemon at ~/.claudeclaw/daemon.pid
  const pidFile = join(DATA_DIR, "daemon.pid");

  let pid: string;
  try {
    pid = (await readFile(pidFile, "utf-8")).trim();
    process.kill(Number(pid), 0);
  } catch {
    console.log("No running daemons found.");
    process.exit(0);
  }

  try {
    process.kill(Number(pid), "SIGTERM");
    console.log(`\x1b[33m■ Stopped\x1b[0m PID ${pid} — ${DATA_DIR}`);
    try { await unlink(pidFile); } catch {}
  } catch {
    console.log(`\x1b[31m✗ Failed to stop\x1b[0m PID ${pid} — ${DATA_DIR}`);
  }

  process.exit(0);
}
