# Preview 0.1 Release Gate

This checklist is the minimum bar for an initial public preview.

## 1. Scope Freeze

Preview includes:
- Matrix channel with long-poll intake (`sync` / `poll`) and appservice-auth-compatible mode.
- `pyash configure intro|channel|mind|agent`.
- Multi-relay mind setup (`ollama`, `openai-codex`, etc.) with one selected default relay.
- Agent runtime with scheduler controls (`pyash calendar health|begin|restart|list`).

Preview excludes (documented as future work):
- Public webhook ingress for external push delivery.
- Non-Matrix channel adapters (Telegram/Discord/Email/WhatsApp).

## 2. Required Smoke Route

Run this full path once on a fresh checkout:

```bash
pyash configure intro
pyash configure channel
pyash configure mind
pyash configure agent
pyash calendar begin
pyash calendar health
pyash calendar list
```

Expected:
- scheduler running
- configured agent appears in calendar output
- channel test path sends greeting
- DM/room replies are produced

## 3. Runtime Safety Defaults

- Agent directory command/write/read licenses are enforced from world policy.
- Agent cwd resolves inside licensed roots.
- Runtime-generated state files remain gitignored.

## 4. Known Limits (must be called out)

- Matrix intake is currently long-poll based (not public webhook push).
- Some provider/tool combinations still depend on local runner/network reachability.
- Appservice mode is auth-compatible now; end-to-end external push deployment is future work.

## 5. Release Artifacts

- Passing `npm test`.
- Updated docs: `documentation/usage.md` and `documentation/recipes/pyash-agent-admin.md`.
- Changelog entry with:
  - included features
  - known limits
  - operator commands for restart/health.
