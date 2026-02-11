# Codex App Server Auth

Use this when configuring a mind relay with `openai-codex`.

## Command

```bash
node command/codex_account.mjs login
```

This spawns:

```text
codex app-server
```

and talks JSON-RPC over stdio.

## Supported actions

- `read`
- `login`
- `cancel --login-id <id>`
- `logout`
- `rate-limits`
- `models` (uses `model/list` with pagination)

Add `--json` for machine-readable output.

## Device-auth style flow

`login` prints:

1. browser URL to open,
2. remote-shell SSH forward hint when callback uses `localhost:<port>`.

The command waits for `account/login/completed`.

Credential persistence note:

- Credentials are managed by Codex tooling state.
- If already authenticated, login returns success without requiring browser re-auth.

## Model discovery

Use:

```bash
node command/codex_account.mjs models --json
```

This returns normalized model entries with:

- `id`
- `displayName`
- `isDefault`
- `defaultReasoningEffort`
- `reasoningEffort` (normalized list)
- `inputModalities` (defaults to `["text","image"]` when omitted)

`pyash configure mind` uses this for `openai-codex` interactive model selection.
When a selected model includes reasoning levels, configure also prompts for `reasoning effort`.

Normalization rules (current implementation):

1. model arrays are accepted from `result.models`, `result.items`, or `result.data`.
2. reasoning options are accepted from either:
   - `reasoningEffort: string[]`, or
   - `supportedReasoningEfforts: [{ reasoningEffort: string }]`.
3. both forms are merged into one de-duplicated `reasoningEffort` list.

## Configure mind integration

`pyash configure mind` with backend/source `openai-codex` supports:

- `--codex-login truth`
- `--codex-bin <path>`

Example:

```bash
pyash configure mind \
  --non-interactive \
  --relay codex \
  --set-default truth \
  --backend openai-codex \
  --host https://api.openai.com \
  --model gpt-5.3-codex \
  --reasoning-effort medium \
  --codex-login truth
```

Interactive order for `openai-codex`:

1. backend/source selection,
2. provider endpoint,
3. optional Codex OAuth login,
4. model list + model selection,
5. reasoning effort selection (when supported),
6. relay name and default relay toggle.
