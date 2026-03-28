# Municipal Reporter Shared Surfaces

This document defines shared base Pyash surfaces for house reporters (for example Owen Sound, Grey County).

## Exported Surfaces

- `program/municipal-pipeline-from-request.pya`
  - Delegates to `command/municipal_reporter_runner.mjs` in `pipeline` mode.
  - Request JSON carries `house_root`, `transcript_dir`, and optional pipeline fields.
- `program/municipal-publish-from-request.pya`
  - Delegates to `command/municipal_reporter_runner.mjs` in `publish` mode.
  - Request JSON carries `house_root`, `payload_json`, and optional publish fields.

Example request (`pipeline`):

```json
{
  "house_root": "/home/htaf/pyac/pyash/world/house/owen-sound-reporter",
  "transcript_dir": "/home/htaf/pyac/pyash/world/house/owen-sound-reporter/artifacts/.../transcript",
  "base_prefix": "meeting-qwen-auto",
  "focus": "the newsworthy juicy and unusual bits",
  "jurisdiction": "Owen Sound",
  "body": "council-meeting-regular",
  "site_url": "https://helpos.ca",
  "discussion_url": "",
  "skip_image": "0",
  "skip_lemmy": "0",
  "timeout_ms": 28800000
}
```

## House Contract

A reporter house is compatible when it provides:

- `program/run-full-transcript-pipeline.mjs`
- `program/publish-meeting-to-helpos-from-payload.mjs`

with argument compatibility matching current Owen Sound scripts.

## Why This Layer

- Keeps a stable Pyash surface in base for all municipal reporters.
- Lets each house keep source-specific adapters (calendar scraping, Escribe, YouTube).
- Reduces copy/paste of command wrappers across houses.
