/**
 * Self-update script for ClaudeClaw.
 *
 * Spawned as a detached child by the /update slash command.
 * Pulls latest code, installs deps if needed, then starts a new daemon
 * with --replace-existing to gracefully replace the old one.
 */

import { readFile, writeFile } from "fs/promises";
import { UPDATE_STATUS_FILE } from "./paths";

interface UpdateStatus {
  requestedAt: number;
  requestedBy: string;
  channelId: string;
  responseUrl?: string;
  previousCommit: string;
  newCommit?: string;
  status: string;
  error?: string;
  startArgs: string[];
  completedAt?: number;
}

async function updateStatus(patch: Partial<UpdateStatus>): Promise<UpdateStatus> {
  const raw = await readFile(UPDATE_STATUS_FILE, "utf-8");
  const status: UpdateStatus = { ...JSON.parse(raw), ...patch };
  await writeFile(UPDATE_STATUS_FILE, JSON.stringify(status, null, 2));
  return status;
}

async function reportFailure(status: UpdateStatus, error: string): Promise<void> {
  await updateStatus({ status: "failed", error, completedAt: Date.now() });

  // Try to notify Slack via response_url (valid for 30 min).
  if (status.responseUrl) {
    await fetch(status.responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `Update failed: ${error}`, response_type: "ephemeral" }),
    }).catch(() => {});
  }
}

function run(cmd: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(cmd, { cwd });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

async function main() {
  const cwd = process.cwd();
  let status: UpdateStatus;

  try {
    status = JSON.parse(await readFile(UPDATE_STATUS_FILE, "utf-8"));
  } catch {
    console.error("[updater] No update-status.json found.");
    process.exit(1);
  }

  try {
    // 1. Pull latest code (fast-forward only)
    await updateStatus({ status: "pulling" });
    const pull = run(["git", "pull", "--ff-only"], cwd);
    if (!pull.ok) {
      await reportFailure(status, `git pull failed: ${pull.stderr}`);
      process.exit(1);
    }

    // 2. Record new commit
    const newCommit = run(["git", "rev-parse", "HEAD"], cwd).stdout;
    status = await updateStatus({ newCommit });

    // 3. Check if lockfile changed → install deps
    const lockDiff = run(
      ["git", "diff", status.previousCommit, "HEAD", "--name-only", "--", "bun.lock"],
      cwd,
    );
    if (lockDiff.stdout) {
      await updateStatus({ status: "installing" });
      const install = run(["bun", "install"], cwd);
      if (!install.ok) {
        await reportFailure(status, `bun install failed: ${install.stderr}`);
        process.exit(1);
      }
    }

    // 4. Mark restarting and spawn new daemon
    await updateStatus({ status: "restarting" });

    const args = [...status.startArgs];
    if (!args.includes("--replace-existing")) args.push("--replace-existing");

    // Brief pause so the status file write flushes.
    await Bun.sleep(500);

    const proc = Bun.spawn([process.execPath, "run", "src/index.ts", "start", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    proc.unref();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await reportFailure(status, msg);
    process.exit(1);
  }
}

main();
