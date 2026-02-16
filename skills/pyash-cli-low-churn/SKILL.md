---
name: pyash-cli-low-churn
description: Maintain and extend the modular Pyash CLI under command/pyash with minimal code churn. Use when changing pyash command routing, configure flows, matrix/mind/agent CLI behavior, or refactoring while preserving main.mjs size and test stability.
---

# Pyash CLI Low Churn

Use this workflow for `command/pyash/` updates.

## Scope Rules

- Keep `command/pyash/main.mjs` as router/wiring only.
- Keep `command/pyash/main.mjs` <= `16384` bytes.
- Prefer module-local edits; avoid cross-module rewrites unless required.

## Ownership Map

- Entry/wiring: `command/pyash/main.mjs`, `command/pyash/main_helpers.mjs`, `command/pyash/main_runtime_helpers.mjs`
- Configure menu: `command/pyash/configure_menu.mjs`
- Matrix configure: `command/pyash/configure_matrix_*.mjs`
- Mind configure: `command/pyash/configure_mind_*.mjs`, `command/pyash/mind_backend_helpers.mjs`
- Agent configure: `command/pyash/configure_agent_*.mjs`
- Runtime commands: `command/pyash/calendar_command.mjs`, `command/pyash/channel_command.mjs`, `command/pyash/codex_cli.mjs`

## Low-Churn Workflow

1. Locate owning module and patch there first.
2. Only touch `main.mjs` when adding/removing wiring.
3. Avoid alias/fallback additions unless explicitly requested.
4. Keep helper behavior deterministic and composable.
5. Preserve existing JSON/text output shapes unless requested.

## Regression Guardrails

- Normalize `--agent-user-id` localpart input in matrix configure paths.
- Do not treat fallback auth defaults as persisted matrix config in doctor checks.
- Redact matrix sensitive outputs consistently:
  - redact `token/password/registrationSharedSecret/adminToken`
  - redact `userId` outside appservice mode.

## Required Validation

- `node command/pyash.mjs --help`
- `node --test quiz/pyash_configure_cli.test.mjs`
- `wc -c command/pyash/main.mjs command/pyash/*.mjs | sort -n`

If a change is isolated, run the targeted test first, then the full configure CLI test.
