---
title: Browser automation (Playwright CLI mapping)
---

# Browser automation (Playwright CLI mapping)

This spec maps browser automation into Pyash-compatible verbs with minimal overlap.
It is designed to wrap a CLI (currently `playwright-cli`) via modules that call
`be command`.

Vocabulary notes (vocab_suggest):

- OK: browser, page, cell, click, press, snapshot, screenshot, go, forward, back,
  reload, open, close, fill, choose, drop, grab, window, pdf, see.
- Blocked: element (use `cell`), select (use `choose`), network (use `web`),
  capture (use `grab`), image (use `photograph` or `film`).

## Orthogonal axes

Keep these dimensions independent so sentences stay small and composable:

1. **Target**: page vs cell (DOM element from snapshot).
2. **Action**: mouse action vs keyboard action vs navigation.
3. **Capture**: snapshot (DOM map) vs screenshot (image artifact) vs pdf.
4. **Window**: active browser window (tab) vs window list.

## Verb table

| Pyash shape | Meaning | CLI mapping | Output |
|---|---|---|---|
| `be open fromtext` | Open URL in browser | `pwcli open <url>` | none |
| `be close` | Close browser session | `pwcli close` | none |
| `be snapshot` | Capture DOM snapshot (cells with ids) | `pwcli snapshot` | map of cells |
| `be screenshot` | Capture full-page screenshot | `pwcli screenshot` | image artifact |
| `be screenshot fromname cell` | Capture element screenshot | `pwcli screenshot e<id>` | image artifact |
| `be click fromname cell` | Mouse click on cell | `pwcli click e<id>` | none |
| `be press fromtext` | Keyboard press | `pwcli press <Key>` | none |
| `be fill fromname cell totext` | Fill input value | `pwcli fill e<id> "<text>"` | none |
| `be choose fromname cell totext` | Select option | `pwcli select e<id> "<value>"` | none |
| `be grab fromname cell` | Begin drag | `pwcli drag e<id> ...` | none |
| `be drop fromname cell` | Drop onto target | `pwcli drag <src> <dst>` | none |
| `be go back` | Navigate back | `pwcli go-back` | none |
| `be go forward` | Navigate forward | `pwcli go-forward` | none |
| `be reload` | Reload page | `pwcli reload` | none |
| `be pdf` | Save page as PDF | `pwcli pdf` | pdf artifact |
| `be window list` | List windows (tabs) | `pwcli tab-list` | list map |
| `be window new` | New window/tab | `pwcli tab-new` | none |
| `be window select fromnum` | Select window/tab | `pwcli tab-select <n>` | none |

Notes:

- **snapshot vs screenshot** are distinct: snapshot returns structured cells; screenshot returns an image.
- **press vs click** are distinct: press is keyboard; click is mouse on a cell.
- `cell` ids come from the latest snapshot and must be refreshed after navigation.

## Minimal module behavior

Modules SHOULD:

- call `be command` with the Playwright CLI wrapper,
- return a structured map for `snapshot` (cells with id/text/role/attrs),
- record screenshots/PDFs as artifacts.

This layer is orthogonal to tool maps: tool exposure uses the same verbs and
parser; only the mood changes.
