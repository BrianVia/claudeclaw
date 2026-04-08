/**
 * Central path resolution for ClaudeClaw.
 *
 * Code lives in the repo; user data lives at ~/.claudeclaw/ by default.
 * Override with CLAUDECLAW_HOME env var.
 */

import { join } from "path";
import { homedir } from "os";

/** Base data directory — all persistent user state lives here. */
export const DATA_DIR: string =
  process.env.CLAUDECLAW_HOME?.trim() ||
  join(homedir(), ".claudeclaw");

// --- Derived paths ---

export const SETTINGS_FILE = join(DATA_DIR, "settings.json");
export const JOBS_DIR = join(DATA_DIR, "jobs");
export const LOGS_DIR = join(DATA_DIR, "logs");
export const SESSION_FILE = join(DATA_DIR, "session.json");
export const SESSIONS_FILE = join(DATA_DIR, "sessions.json");
export const STATE_FILE = join(DATA_DIR, "state.json");
export const PID_FILE = join(DATA_DIR, "daemon.pid");
export const WHISPER_DIR = join(DATA_DIR, "whisper");
export const INBOX_DIR = join(DATA_DIR, "inbox");

/** Project-level prompt overrides (user-owned, outside the repo). */
export const USER_PROMPTS_DIR = join(DATA_DIR, "prompts");
