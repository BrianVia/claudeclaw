// Search ClawHub skill registry and return JSON results
// Usage: node search.mjs <query>
// Works with Node 18+, Bun, Deno

const query = process.argv[2];
if (!query) {
  console.log(JSON.stringify({ error: "No search query provided" }));
  process.exit(1);
}

try {
  const res = await fetch(
    `https://clawhub.ai/api/v1/search?q=${encodeURIComponent(query)}`
  );

  if (!res.ok) {
    console.log(
      JSON.stringify({ error: `ClawHub API returned ${res.status}` })
    );
    process.exit(1);
  }

  const data = await res.json();
  const results = (data.results || []).map((r) => ({
    slug: r.slug,
    displayName: r.displayName,
    summary: r.summary,
    downloads: r.updatedAt ? undefined : undefined,
    version: r.version || null,
  }));

  // Fetch download stats for top results (in parallel)
  const top = results.slice(0, 10);
  const detailed = await Promise.all(
    top.map(async (r) => {
      try {
        const detail = await fetch(
          `https://clawhub.ai/api/v1/skills/${r.slug}`
        );
        if (detail.ok) {
          const d = await detail.json();
          return {
            slug: r.slug,
            displayName: r.displayName,
            summary: r.summary,
            downloads: d.skill?.stats?.installsAllTime ?? 0,
            version: d.latestVersion?.version ?? null,
          };
        }
      } catch {
        // fall through
      }
      return { ...r, downloads: 0 };
    })
  );

  console.log(JSON.stringify(detailed, null, 2));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
}
