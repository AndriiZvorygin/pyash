# SearXNG For Agent Web Search

This is a standalone SearXNG + Redis stack you can run locally and point agents at for web search.

## What This Provides

- HTTP search endpoint on `http://localhost:60490`
- JSON search output via `/search?format=json`
- Local config in `configure/searxng/settings.yml`
- Auto-generated secret in `configure/ecology/searxng.env`

## Files

- `service/compose.yaml`
- `configure/searxng/settings.yml`
- `command/begin.sh`
- `command/stop.sh`
- `.gitignore` (ignores generated secret env file)

## Quick Start

From this folder:

```bash
./command/begin.sh
```

Stop:

```bash
./command/stop.sh
```

## Verify Search API

```bash
curl "http://localhost:60490/search?q=site%3Awikipedia.org+large+language+model&format=json"
```

If healthy, response includes a `results` array.

## Using With Agents

Point your agent web-search tool to:

- Base URL: `http://localhost:60490/search`
- Required query params:
  - `q=<query>`
  - `format=json`

Optional params:

- `language=en`
- `safesearch=0`
- `pageno=1`

Example tool request:

```text
GET http://localhost:60490/search?q=containerized+searxng+setup&format=json
```

## URL By Runtime Context

- Host machine process:
  - `http://localhost:60490/search?format=json&q=...`
- Pyash/container network process:
  - `http://searxng:8080/search?format=json&q=...`

Use `searxng:8080` when the caller runs inside the same Docker compose network (the standard Pyash container flow).

## Pyash Integration Note

If using Pyash search tooling, set web search motor to this endpoint and restart your Pyash container runtime so search requests route here.
