# 12. Web And Browser

Purpose: define the web-retrieval surface (`be search`, `be download`) and browser automation surface in one place.

## 1. Scope

This chapter covers:
- web search queries (`be search ... fromstate wo web`)
- download flows (`be download ... as wo web`)
- browser automation verbs mapped to a browser module/runtime

Filesystem search and filesystem reads are out of scope.

## 2. `be search` (web family)

A `be search` call is in web mode when it includes:
- `fromstate wo web`

Canonical form:

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

Default source should come from a default sentence:

```pyash
su name web search motor ob filename "https://search.example/" be default ya
```

## 3. Search output contract

Search returns a map.

Top-level map requirements:
- include metadata with query, source, and limit
- include one deterministic entry per hit

Per-hit sentence requirements:
- `su name <entry key>`
- `atindex num <rank>`
- `from filename "<url>"`
- optional `ob text "<title>"`
- optional `as text "<snippet>"`

Ordering must be deterministic by rank.

## 4. Errors

Recommended stable names:
- `web search question lost`
- `web search motor lost`
- `web search defective`

## 5. Browser automation surface

Browser automation is exposed through module-backed verbs. Runtime may wrap Playwright CLI or equivalent.

Canonical action families:
- navigation: `be open`, `be go back`, `be go forward`, `be reload`, `be close`
- capture: `be snapshot`, `be screenshot`, `be pdf`
- input: `be click`, `be press`, `be fill`, `be choose`
- window control: `be window list|new|select`

Cell-targeted actions use IDs from the latest snapshot.

## 6. Determinism rules

- snapshot output is structured and stable for the same page state
- screenshot/pdf artifacts are recorded through standard artifact rules
- module adapters must return sentence-shaped output, not ad-hoc JSON blobs

## 7. Implementation profile

The detailed browser mapping and examples are maintained in:
- `documentation/recipes/spec-archive/16-browser-automation.full.md` (if present)
- `documentation/recipes/spec-archive/12-web-search.full.md` (if present)

This chapter is the normative contract.
