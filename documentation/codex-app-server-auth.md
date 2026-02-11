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

Add `--json` for machine-readable output.

## Device-auth style flow

`login` prints:

1. browser URL to open,
2. remote-shell SSH forward hint when callback uses `localhost:<port>`.

The command waits for `account/login/completed`.

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
  --model gpt-5-codex \
  --codex-login truth
```
