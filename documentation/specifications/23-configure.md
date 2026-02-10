# `23-configure.md`

Status: draft v0.2

Purpose: define a channel-first and agent-aware configuration flow for Pyash.

---

## 1. Scope

This chapter defines:

1. canonical `pyash configure` command routes,
2. interactive configuration UX standards,
3. caterer plugin contract for configuration/test/doctor,
4. deterministic managed writes in `configure/secret.pya`,
5. machine-readable output for automation.

This chapter applies to:

- orchestrator setup (`configure orchestrator`),
- channel setup (matrix now, more caterers later),
- mind bridge setup (`configure mind`),
- agent setup (`configure agent`).

---

## 2. Command contract

Canonical route family:

1. `pyash configure`
2. `pyash configure orchestrator`
3. `pyash configure channel`
4. `pyash configure channel list`
5. `pyash configure channel <caterer>`
6. `pyash configure channel <caterer> test`
7. `pyash configure channel <caterer> doctor`
8. `pyash configure mind`
9. `pyash configure agent`

Examples:

- `pyash configure channel matrix`
- `pyash configure channel matrix --non-interactive --homeserver https://matrix.org --room '#pyash:matrix.org' --auth-mode password --agent-user-id '@mybot:matrix.org' --password '***'`
- `pyash configure channel matrix doctor`

Rules:

1. No compatibility aliases are required by this spec.
2. New caterers MUST be attached under `configure channel <caterer>`.
3. `pyash configure` and `pyash configure channel` SHOULD loop back to menu after each completed action until explicit exit.

Canonical onboarding order:

1. `configure orchestrator`
2. `configure channel`
3. `configure mind`
4. `configure agent`

Each stage SHOULD print the next recommended command after success.

---

## 3. UX standard (interactive)

Every prompt step MUST use this order:

1. `[Section X.Y: Title]`
2. `Why this matters: ...`
3. `How to get it: ...`
4. `Examples: ...`
5. actual prompt line

Rules:

1. Guidance MUST appear before user input, not after.
2. Steps MUST be grouped by intent.
3. Flow MUST support `quickstart` and `advanced` modes.
4. Quickstart asks minimum required fields only.
5. Advanced exposes optional routing/conduct overrides.
6. Each step SHOULD validate immediately before moving to the next step.

Channel section groups (current implementation):

- `A`: homeserver
- `B`: auth
- `C`: room/channel
- `D`: executive DM target
- `E`: optional agent conduct file write

Flow ordering rule:

1. homeserver first,
2. auth second (must pass before channel step),
3. room/channel third,
4. optional executive DM test fourth.

---

## 4. Caterer plugin contract

Each caterer MUST expose a deterministic contract:

1. `collect` — gather values (interactive and/or flags)
2. `verification` — return field errors/warnings with stable names
3. `test` — attempt live connectivity/auth check
4. `doctor` — diagnose current stored config and print actionable fixes
5. `renderManagedBlocks` — produce managed block content for files
6. `redact` — hide secrets from display/json output

Caterer behavior constraints:

1. same input must produce same verification result,
2. write plan must be side-effect-free until explicit apply,
3. test/doctor must never print raw secrets.
4. interactive setup SHOULD perform incremental validation and live checks where feasible.

---

## 5. Managed config shape

`configure/secret.pya` MUST store channel config as maps.

Canonical container:

```text
su name matrix channel be map def
  su name homeserver ob text "https://matrix.org" ya
  su name room ob text "#pyash:matrix.org" ya
  su name executive username ob text "@andrii:matrix.org" ya
  su name user ob text "@pyash-agent:matrix.org" ya
  su name auth mode ob text "password" ya
  su name token ob text "..." ya
prah

su name channel configure be map def
  su name default caterer ob text "matrix" ya
  su name matrix ob name matrix channel ya
prah
```

Agent channel conduct MAY also be written to:

- `world/house/<agent>/conduct/channels.pya`

Managed write rules:

1. writes MUST be bounded by managed start/end markers,
2. repeated runs MUST be idempotent,
3. caterer sections MUST be replaceable without touching unrelated sections.
4. interactive setup MAY also write per-agent channel conduct at `world/house/<agent>/conduct/channels.pya`.

---

## 6. Verification and test requirements

Verification MUST include:

1. required field presence by caterer,
2. field format checks (URL, channel id, user id, etc.),
3. cross-field checks (for example server/domain consistency),
4. write-target permissions/path existence checks.
5. homeserver-specific auth constraints (for example matrix.org MUST NOT allow shared-secret mode).

`test` command behavior:

1. run caterer live check (auth + destination reachability),
2. return pass/fail and concise diagnosis,
3. no config mutation unless explicitly requested,
4. for matrix: SHOULD join target room and send greeting test message,
5. if executive user is configured: SHOULD send executive DM test message.

`doctor` command behavior:

1. inspect current stored config,
2. classify issues (`missing`, `invalid`, `auth_failed`, `unreachable`, `warning`),
3. provide exact remediation steps.

---

## 7. Output modes

All configure routes SHOULD support:

1. `--dry-run` (no write),
2. `--print` (render planned blocks),
3. `--json` (machine-readable report),
4. `--non-interactive` (flag-only execution).
5. `--test-now` (enable/disable post-config live test).

Machine-readable report SHOULD include:

1. command route,
2. caterer,
3. verification errors/warnings,
4. planned file writes,
5. test/doctor status,
6. redacted applied config summary.

---

## 8. Matrix caterer profile (initial)

Matrix profile minimally covers:

1. homeserver,
2. room id/alias,
3. executive username (optional),
4. agent user id (optional, recommended),
5. auth mode: `password | token | shared-secret`.

Auth notes:

1. `password` mode may exchange credentials for token.
2. `token` mode uses provided access token directly.
3. `shared-secret` targets Synapse operator flows (self-hosted).
4. `shared-secret` MUST be disallowed for `matrix.org`.

Test profile:

1. verify auth is accepted,
2. verify/join target room and send greeting,
3. verify optional executive DM greeting,
4. return clear actionable failure reasons.

Interactive matrix notes:

1. If homeserver protocol is omitted, implementation SHOULD default to `https://`.
2. Secret prompts (password/token/shared-secret) SHOULD hide input echo.
3. Shared-secret flow SHOULD ask for shared secret before default agent username.
4. Shared-secret flow should explain that this configures a default agent identity for channel setup.

---

## 9. Security requirements

1. Secret values MUST be redacted in screen output and JSON.
2. Secret prompts SHOULD avoid echo where terminal support exists.
3. Error messages MUST avoid leaking credentials.
4. Stored secrets in `configure/secret.pya` SHOULD support future external secret backends.

---

## 10. Conformance checklist

A configure implementation conforms to this spec when it:

1. uses `configure channel <caterer>` as canonical entrypoint,
2. follows interactive sectioned prompt format,
3. supports deterministic caterer `verification/test/doctor` contract,
4. writes idempotent managed map blocks,
5. supports `--dry-run`, `--print`, `--json`, and `--non-interactive`,
6. redacts secrets in all non-storage outputs.
7. interactive flow validates each step before advancing.
8. matrix flow enforces homeserver-aware auth options.

---

## 11. Onboarding

First-time onboarding MUST prioritize dependency order:

1. Orchestrator first: initialize runtime control plane (locks, presence, scheduler health paths).
2. Channel second: validate ingress/egress and message tests.
3. Mind third: validate backend/model bridge and generation health checks.
4. Agent fourth: bind to orchestrator + channel + mind defaults and run smoke test.

Recommended success prompts:

1. after orchestrator: `next: pyash configure channel`
2. after channel: `next: pyash configure mind`
3. after mind: `next: pyash configure agent`
4. after agent: `next: pyash orchestrator begin`

---

## 12. Configure Orchestrator

Purpose: set up the runtime control plane that `pyash` uses to manage scheduler, channels, and agents.

Current target profile:

1. container-first runtime (host-native runtime is future work),
2. host-side `pyash` command can control container runtime over a control endpoint.

Baseline setup fields:

1. runtime mode: `container` (default and currently supported path),
2. start mode: `manual | auto`,
3. control port: default `59652`,
4. health check: required before success.

Advanced fields (optional):

1. custom control endpoint host/bind,
2. custom world/root paths,
3. lock/presence path overrides,
4. concurrency caps.

Control-plane contract:

1. container runtime exposes orchestrator control endpoint,
2. host `pyash` uses configured control endpoint to run `status/configure/begin/stop/doctor` style actions,
3. default control endpoint SHOULD use port `59652` unless overridden.

Success output SHOULD include:

1. selected mode and start behavior,
2. resolved control endpoint (for example `http://localhost:59652`),
3. health check pass/fail details,
4. next recommended step: `pyash configure channel`.

---

## 13. Configure Agent

Purpose: set up default agent identity/runtime settings after channel setup.

Canonical commands:

1. `pyash configure agent`
2. `pyash configure agent --non-interactive ...` (future)

Recommended interactive order:

1. Agent name and purpose.
2. Runtime backend selection (`mind`/model path and tool map defaults).
3. Channel binding to existing `channel configure` data.
4. Schedule defaults (interval/calendar seed).
5. Validate by running an agent smoke check (`begin`/single message/stop path).

Advanced-only step (optional):

1. Session/runtime tuning (history window, retries, guarantee/reviewer toggles).

Managed outputs SHOULD include:

1. `world/house/<agent>/identity/IDENTITY.md` managed purpose block.
2. `world/house/<agent>/conduct/managed.pya` desired-state hash facts.
3. `world/house/<agent>/conduct/calendar.pya` when schedule defaults are enabled.
4. `world/house/<agent>/conduct/channels.pya` when channel binding is enabled.

Agent configure conformance (initial target):

1. idempotent reconcile (`created|updated|unchanged`),
2. deterministic file writes with managed boundaries,
3. optional start test that does not leave scheduler in unknown state,
4. machine-readable summary in `--json` mode,
5. channel binding and schedule setup available in baseline flow (non-advanced).

---

## 14. Open items

1. Final map names for multi-caterer routing conduct in `world/house/<agent>/conduct/channels.pya`.
2. Whether `test` should auto-resolve Matrix alias to room id and persist normalization.
3. Unified caterer capability matrix output for `configure channel list`.
4. Final `configure agent` non-interactive flag contract and storage map keys.
5. Final `configure orchestrator` managed file schema and endpoint auth model.
6. `configure mind` command contract and default bridge/profile schema.
