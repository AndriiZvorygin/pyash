# 12. Web And Browser

Purpose: define web retrieval (`search`/`download`) and browser automation contracts.

## 1. Keyword table

| Keyword/case | Meaning | Application |
| --- | --- | --- |
| `fromstate wo web` | web search mode selector | disambiguate from filesystem search |
| `by num <limit>` | result limit | deterministic cap |
| `from filename "<url>"` | explicit source/motor/url | search engine override or fetch source |
| `as wo web` | web download mode | URL retrieval intent |
| `atindex num <rank>` | search ranking index | stable result ordering |

## 2. Canonical web search

```pyash
su name found
ob text "query text"
fromstate wo web
by num 5
be search do
```

Optional source override:
```pyash
from filename "https://search.example/"
```

## 3. Search output model

Per result entry should include:
- `su name <entry>`
- `atindex num <rank>`
- `from filename "<url>"`
- optional title/snippet payloads

## 4. Browser automation surface

Action groups:
- navigation: `open`, `go back`, `go forward`, `reload`, `close`
- capture: `snapshot`, `screenshot`, `pdf`
- input: `click`, `press`, `fill`, `choose`
- windows: `window list`, `window new`, `window select`

## 5. Canonical application example

```pyash
from filename "https://example.com" to filename "example.html" as wo web be download do
from filename "example.html" to name text out become text "text" be read do
```

## 6. Determinism and errors

- deterministic ranking/order for search outputs,
- sentence-shaped adapter outputs,
- stable errors: `web search question lost`, `web search motor lost`, `web search defective`.

## 7. References

- `documentation/recipes/spec-archive/12-web-search.full.md`
- `documentation/recipes/spec-archive/16-browser-automation.full.md`
