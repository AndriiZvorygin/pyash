# Automation Checklist

Use this checklist when creating or updating scheduled automation in Pyash.

## Agent scope
- [ ] Agent exists under `world/house/<agent>/` (establish/reconcile done).
- [ ] Work is scoped to house root and explicit shared roots only.
- [ ] Automation code lives in `world/house/<agent>/program/` unless intentionally shared.

## Scheduling and control
- [ ] Job is declared in `conduct/calendar.pya` (agent-local or global).
- [ ] Scheduler controls verified (`begin`, `health`, `stop`).
- [ ] Overlap prevention is in place (presence/lock behavior).

## Artifacts and logs
- [ ] Outputs go to `world/house/<agent>/artifacts/<run-id>/`.
- [ ] Status/delta outputs are deterministic and machine-readable.
- [ ] Logs avoid secrets and include enough context to debug failures.

## Alerting
- [ ] Alert reasons are aggregated into a single report per run.
- [ ] Improvement and failure paths are separated.
- [ ] Alert includes artifact path to detailed diagnostics.
- [ ] Matrix settings come from `matrix channel` map (homeserver, room, token or shared secret).

## Verification
- [ ] Baseline stage runs successfully.
- [ ] Fix stage is bounded and deterministic.
- [ ] Re-run stage confirms improvement or clearly reports no improvement.
- [ ] `npm test` passes after fixes (for coding/parity automation).
