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

YaCy's JSON API can be selected as the source endpoint:
```pyash
su name found
ob text "technology /date"
fromstate wo web
from filename "https://search.example/yacysearch.json"
by num 5
be search do
```

When the source path ends in `/yacysearch.json`, search sends the query using
YaCy's `query`, `maximumRecords`, and `contentdom=text` parameters and converts
the returned channel items into the same ranked result map. The result metadata
records `complete`, `partial`, or `incomplete` status. An incomplete response
with zero items is not evidence that the search had no matches. Peer failure
details are reduced to safe summary text; the API may expose peer addresses in
diagnostics.

Yago's authenticated agent API can also be selected as the source endpoint:
```pyash
su name found
ob text "technology news"
fromstate wo web
from filename "https://yago.example/search"
by num 5
be search do
```

Yago search uses `POST /search` with JSON `{ "query": "...", "max_results": 5 }`
and `Authorization: Bearer ...`. Use a key with the `search:read` scope. The key
is read from `yago api key` in `configure/secret.pya` or `YAGO_API_KEY`; result
records are normalized from the Tavily-compatible `results` array. Yago uses
HTTP 409 with `Retry-After` when no rows were found and at least one source
failed. Pyash retries once, then reports an incomplete zero-result response if
the source failure persists. The saddle should use the service API guide for
the endpoint and ask for explicit configuration when the key is missing. It
should never download the search homepage to infer API behavior.

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
