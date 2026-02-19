# Pyash CLI Modules

This document describes the modular CLI layout under `command/pyash/` and the low-churn update path.

## Goals

- Keep `command/pyash/main.mjs` at or below `16384` bytes.
- Put command logic in dedicated modules, not in the entrypoint.
- Prefer focused edits in one module over broad rewrites.

## Routing Layout

- `command/pyash.mjs`: thin wrapper entry.
- `command/pyash/main.mjs`: command routing and wiring only.
- `command/pyash/configure_menu.mjs`: interactive configure menu flows.
- `command/pyash/calendar_command.mjs`: `pyash calendar ...`.
- `command/pyash/channel_command.mjs`: `pyash channel ...`.
- `command/pyash/codex_cli.mjs`: `pyash codex ...`.
- `command/pyash/agent_command.mjs`: `pyash agent <name> --codex ...`.

## Configure Modules

- Matrix:
`configure_matrix_command.mjs`, `configure_matrix_state.mjs`, `configure_matrix_interactive.mjs`, `configure_matrix_doctor.mjs`, `configure_matrix_write_plan.mjs`, `configure_matrix_runtime.mjs`.
- Mind:
`configure_mind_command.mjs`, `configure_mind_support.mjs`, `configure_mind_interactive.mjs`, `mind_backend_helpers.mjs`.
- Agent:
`configure_agent_command.mjs`, `configure_agent_helpers.mjs`, `configure_agent_runtime.mjs`.
- Orchestrator:
`configure_orchestrator_command.mjs`.

## Shared Helpers

- CLI args: `cli_args.mjs`
- File/root helpers: `fs_paths.mjs`
- Managed blocks: `managed_blocks.mjs`
- Matrix utilities/API/schedule: `matrix_helpers.mjs`, `matrix_api.mjs`, `matrix_schedule.mjs`
- Main wiring helpers: `main_helpers.mjs`, `main_runtime_helpers.mjs`
- Process runners: `process_exec.mjs`

## Low-Churn Update Checklist

1. Identify the command family first (`calendar`, `channel`, `configure matrix`, `configure mind`, etc.).
2. Patch the smallest owning module.
3. Keep interfaces stable; only change wiring in `main.mjs` when ownership moves.
4. Re-run targeted tests before broad tests.
5. Verify `main.mjs` size and all module sizes.

## Known Regression Traps

- `--agent-user-id` plain localpart (for example `ccrc`) must normalize to full Matrix user id for inference paths.
- Matrix doctor `missing_config` should not treat default auth-mode fallback as configured state.
- Matrix config redaction:
token/password/shared-secret modes redact `userId`; appservice mode keeps `userId`.

## Validation Commands

- CLI help: `node command/pyash.mjs --help`
- Targeted configure tests: `node --test quiz/pyash_configure_cli.test.mjs`
- File size budget: `wc -c command/pyash/main.mjs command/pyash/*.mjs | sort -n`
