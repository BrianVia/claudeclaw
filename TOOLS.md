# Tools

External tools available to Claw via MCP servers. These are configured in `.mcp.json` and available in every session.

## Workspace (QMD)

Local knowledge base powered by QMD. Use for querying project-specific documentation and context.

- **Server:** `workspace`
- **Command:** `qmd mcp`

## Perplexity

Web search, reasoning, and deep research via Perplexity's Sonar models. Use when you need to look something up, answer questions about current events, or research a topic.

- **Server:** `perplexity`
- **Env:** `PERPLEXITY_API_KEY`

### Tools

| Tool | Model | Use When |
|------|-------|----------|
| `search` | Sonar Pro | Quick lookups, simple factual questions, current info |
| `reason` | Sonar Reasoning Pro | Complex multi-step questions, comparisons, analysis |
| `deep_research` | Sonar Deep Research | Comprehensive reports, in-depth topic exploration |

All tools accept a `query` string. `deep_research` also accepts `focus_areas` (string array) to guide the research.

## Firecrawl

Web scraping, crawling, and page interaction. Use when you need to read a specific URL, extract structured data from a site, or interact with web pages.

- **Server:** `firecrawl`
- **Env:** `FIRECRAWL_API_KEY`

### Tools

| Tool | Use When |
|------|----------|
| `firecrawl_scrape` | Extract content from a specific URL (markdown, HTML, JSON) |
| `firecrawl_search` | Search the web and get full page content from results |
| `firecrawl_map` | Discover all URLs on a website |
| `firecrawl_crawl` | Bulk extract content from an entire site section |

### Workflow

1. **Search** — no URL yet, find pages on a topic
2. **Scrape** — have a URL, get its content
3. **Map** — find specific pages within a large site
4. **Crawl** — bulk extract (e.g., all /docs/ pages)

## When to Use What

- **Need current info / facts / news?** → Perplexity `search`
- **Need to understand a complex topic?** → Perplexity `reason` or `deep_research`
- **Need content from a specific URL?** → Firecrawl `scrape`
- **Need to find pages on a site?** → Firecrawl `map` or `search`
- **Need project-specific context?** → Workspace (QMD)
