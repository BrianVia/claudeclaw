// Download and install a skill from ClawHub
// Usage: node install.mjs <slug> [target-dir]
// Works with Node 18+, Bun, Deno

import { mkdirSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { execSync } from "child_process";

const slug = process.argv[2];
const targetDir = process.argv[3] || join(homedir(), ".claude", "skills");

if (!slug) {
  console.log(
    JSON.stringify({ error: "Usage: node install.mjs <slug> [target-dir]" })
  );
  process.exit(1);
}

try {
  // 1. Fetch skill metadata to get latest version
  const metaRes = await fetch(`https://clawhub.ai/api/v1/skills/${slug}`);
  if (!metaRes.ok) {
    console.log(
      JSON.stringify({
        error: `Skill "${slug}" not found on ClawHub (${metaRes.status})`,
      })
    );
    process.exit(1);
  }

  const meta = await metaRes.json();
  const version = meta.latestVersion?.version;
  if (!version) {
    console.log(
      JSON.stringify({ error: `No published version found for "${slug}"` })
    );
    process.exit(1);
  }

  // 2. Download zip archive
  const dlUrl = `https://clawhub.ai/api/v1/download?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(version)}`;
  const dlRes = await fetch(dlUrl);
  if (!dlRes.ok) {
    console.log(
      JSON.stringify({
        error: `Download failed for ${slug}@${version} (${dlRes.status})`,
      })
    );
    process.exit(1);
  }

  // 3. Write zip to temp file
  const zipBytes = new Uint8Array(await dlRes.arrayBuffer());
  const tmpZip = join(tmpdir(), `clawhub-${slug}-${version}.zip`);
  writeFileSync(tmpZip, zipBytes);

  // 4. Extract to target directory
  const destDir = join(targetDir, slug);
  mkdirSync(destDir, { recursive: true });
  execSync(`unzip -o "${tmpZip}" -d "${destDir}"`, { stdio: "pipe" });

  // 5. Clean up zip
  try {
    execSync(`rm "${tmpZip}"`, { stdio: "pipe" });
  } catch {
    // non-critical
  }

  // 6. Write origin tracking file
  const originDir = join(destDir, ".clawhub");
  mkdirSync(originDir, { recursive: true });
  writeFileSync(
    join(originDir, "origin.json"),
    JSON.stringify(
      {
        version: 1,
        registry: "https://clawhub.ai",
        slug,
        installedVersion: version,
        installedAt: Date.now(),
      },
      null,
      2
    )
  );

  // 7. List installed files
  const files = listFiles(destDir).filter(
    (f) => !f.startsWith(".clawhub/")
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        slug,
        version,
        displayName: meta.skill?.displayName ?? slug,
        path: destDir,
        files,
      },
      null,
      2
    )
  );
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
}

function listFiles(dir, prefix = "") {
  const entries = readdirSync(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...listFiles(join(dir, entry.name), rel));
    } else {
      result.push(rel);
    }
  }
  return result;
}
