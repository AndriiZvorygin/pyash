# `23-configure.md`

Status: draft v0.3

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
- mind relay setup (`configure mind`) for provider/source defaults,
- agent setup and lifecycle (`configure agent list|establish|improve|delete`).

---

## 2. Command contract

Canonical route family:

1. `pyash configure`
2. `pyash configure intro`
3. `pyash configure orchestrator`
4. `pyash configure channel`
5. `pyash configure channel list`
6. `pyash configure channel <caterer>`
7. `pyash configure channel <caterer> test`
8. `pyash configure channel <caterer> doctor`
9. `pyash configure mind`
10. `pyash configure agent`
11. `pyash configure agent list`
12. `pyash configure agent establish`
13. `pyash configure agent improve`
14. `pyash configure agent delete`

Examples:

- `pyash configure channel matrix`
- `pyash configure channel matrix --non-interactive --homeserver https://matrix.org --room '#pyash:matrix.org' --auth-mode password --agent-user-id '@mybot:matrix.org' --password '***'`
- `pyash configure channel matrix doctor`

Rules:

1. No compatibility aliases are required by this spec.
2. New caterers MUST be attached under `configure channel <caterer>`.
3. `pyash configure` and `pyash configure channel` SHOULD loop back to menu after each completed action until explicit exit.
4. `pyash configure mind` SHOULD probe Ollama (`/api/tags`) when backend is Ollama-compatible, list available models, and allow selecting default model by name or index.
5. `pyash configure mind` SHOULD support multiple named relays and exactly one selected default relay.
6. `pyash configure agent` SHOULD allow per-agent backend/model override (including refinery alias in model field).
7. Mind backend picker SHOULD present short backend keys (for example `openai-api` and `openai-codex`) instead of requiring multi-word backend commands.
8. `pyash configure mind` SHOULD support named relays (`--relay <name>`) and one selected default relay (`--set-default truth|lie`).
9. `pyash configure mind` SHOULD support provider-specific auth setup when needed (for example `--codex-login truth` for `openai-codex`).
10. `pyash configure mind` SHOULD list Codex models via `model/list` when source is `openai-codex` and auth state is available.
11. `pyash configure mind` SHOULD show existing relay/default state before prompting for a new relay.
12. `pyash configure agent` interactive route SHOULD open a management menu (`list`, `establish`, `improve`, `delete`) instead of directly entering establish prompts.

Canonical onboarding order:

1. `configure orchestrator`
2. `configure channel`
3. `configure mind`
4. `configure agent`

`configure intro` SHOULD present this order with per-step configured/pending status.

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
6. Each step SHOULD verify immediately before moving to the next step.

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

Caterer conduct constraints:

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

`test` command conduct:

1. run caterer live check (auth + destination reachability),
2. return pass/fail and concise diagnosis,
3. no config mutation unless explicitly requested,
4. for matrix: SHOULD join target room and send greeting test message,
5. if executive user is configured: SHOULD send executive DM test message.

`doctor` command conduct:

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
6. for mind setup: `--codex-login` and `--codex-bin` for Codex OAuth bootstrap.

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

---

## 9. Mind relay profile (initial)

Mind setup stores short-source identity plus canonical backend command.

Canonical managed shape:

```text
su name mind relays be map def
  su name default relay ob text "default" ya
  su name relay default source ob text "openai-codex" ya
  su name relay default backend ob text "openai command mind" ya
  su name relay default host ob text "https://api.openai.com" ya
  su name relay default model ob text "gpt-5.3-codex" ya
  su name relay default reasoning effort ob text "medium" ya
  su name relay local source ob text "ollama" ya
  su name relay local backend ob text "ollama command mind" ya
  su name relay local host ob text "http://mriczo:11434" ya
  su name relay local model ob text "qwen3-vl:8b-instruct" ya
  su name relay local reasoning effort ob text "" ya
prah

su name mind configure be map def
  su name source ob text "openai-codex" ya
  su name backend ob text "openai command mind" ya
  su name host ob text "https://api.openai.com" ya
  su name model ob text "gpt-5.3-codex" ya
  su name reasoning effort ob text "medium" ya
prah

exists su name mind relay default ob text "default" be default ya
exists su name mind source ob text "openai-codex" be default ya
exists su name mind backend be default ob name openai command mind ya
exists su name ollama host ob text "https://api.openai.com" be default ya
exists su name ai host ob text "https://api.openai.com" be default ya
exists su name mind model ob text "gpt-5.3-codex" be default ya
exists su name mind reasoning effort ob text "medium" be default ya
```

Rules:

1. `source` disambiguates auth strategy when canonical backend text is shared.
2. `openai-codex` MAY invoke Codex App Server login flow during configure.
3. when model metadata includes reasoning options, configure SHOULD capture `reasoning effort`.
4. repeated configure runs MUST be idempotent for relay/source/backend/host/model/reasoning blocks.
5. configure SHOULD allow configuring another relay in the same command run.
6. selected default relay SHOULD update both `mind relays` and default facts.

Codex model metadata parsing rules:

1. model list payload MAY be in `result.models`, `result.items`, or `result.data`.
2. reasoning options MAY be present as:
   - `reasoningEffort: [\"low\", \"medium\", ...]`, or
   - `supportedReasoningEfforts: [{ reasoningEffort: \"low\" }, ...]`.
3. configure MUST normalize both shapes into one reasoning options list for selection.
4. default reasoning selection SHOULD use `defaultReasoningEffort` when present.

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

## 10. Security requirements

1. Secret values MUST be redacted in screen output and JSON.
2. Secret prompts SHOULD avoid echo where terminal support exists.
3. Error messages MUST avoid leaking credentials.
4. Stored secrets in `configure/secret.pya` SHOULD support future external secret backends.

---

## 11. Conformance checklist

A configure implementation conforms to this spec when it:

1. uses `configure channel <caterer>` as canonical entrypoint,
2. follows interactive sectioned prompt format,
3. supports deterministic caterer `verification/test/doctor` contract,
4. writes idempotent managed map blocks,
5. supports `--dry-run`, `--print`, `--json`, and `--non-interactive`,
6. redacts secrets in all non-storage outputs.
7. interactive flow verifies each step before advancing.
8. matrix flow enforces homeserver-aware auth options.

---

## 12. Onboarding

First-time onboarding MUST prioritize dependency order:

1. Orchestrator first: initialize runtime control plane (locks, presence, scheduler health paths).
2. Channel second: verify input/produce message tests.
3. Mind third: verify backend/model bridge and generation health checks.
4. Agent fourth: bind to orchestrator + channel + mind defaults and run smoke test.

Recommended success prompts:

1. after orchestrator: `next: pyash configure channel`
2. after channel: `next: pyash configure mind`
3. after mind: `next: pyash configure agent`
4. after agent: `next: pyash orchestrator begin`

---

## 13. Configure Orchestrator

Purpose: set up the runtime control plane that `pyash` uses to manage scheduler, channels, and agents.

Normative orchestrator definition and responsibility contract is defined in:

1. `documentation/specifications/18-pyash-agent.md`, section `13.1 Orchestrator contract (normative)`.
2. `documentation/specifications/18-pyash-agent.md`, section `13.2 Runtime component boundaries (normative)`.

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

Out of scope for orchestrator configure:

1. schedule rhythm/poll timing knobs,
2. per-channel poll frequency,
3. job-level calendar declarations.
4. saddle execution policy internals,
5. router conduct for `as wo input` / `as wo produce`.

These MUST be configured via calendar policy (`world/conduct/calendar.pya` and agent-local calendar), not orchestrator config maps.

Control-plane contract:

1. container runtime exposes orchestrator control endpoint,
2. host `pyash` uses configured control endpoint to run `status/configure/begin/stop/doctor` style actions,
3. default control endpoint SHOULD use port `59652` unless overridden.

Success output SHOULD include:

1. selected mode and start conduct,
2. resolved control endpoint (for example `http://localhost:59652`),
3. health check pass/fail details,
4. next recommended step: `pyash configure channel`.

---

## 14. Configure Agent

Purpose: set up default agent identity/runtime settings after channel setup.

Canonical commands:

1. `pyash configure agent`
2. `pyash configure agent list`
3. `pyash configure agent establish`
4. `pyash configure agent improve`
5. `pyash configure agent delete`
6. `pyash configure agent <action> --non-interactive ...`

Recommended interactive order:

1. Open management menu (`list`, `establish`, `improve`, `delete`, `exit`).
2. For `establish` and `improve`:
   - Agent name and purpose.
   - Runtime backend/model/tools map.
     Notes: defaults are inherited from `configure mind`, then overridden per agent.
   - Channel bind toggle.
   - Schedule interval.
   - Optional smoke test (`begin`/`stop`).
3. For `delete`:
   - Choose agent.
   - Confirm deletion.
   - Stop agent services before removing house directory.

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
5. channel binding and schedule setup available in baseline flow (non-advanced),
6. delete path must be explicit and non-implicit (`delete` action only),
7. `base` house must never be deletable.

---

## 15. Open items

1. Final map names for multi-caterer routing conduct in `world/house/<agent>/conduct/channels.pya`.
2. Whether `test` should auto-resolve Matrix alias to room id and persist normalization.
3. Unified caterer capability matrix output for `configure channel list`.
4. Additional guardrails for `configure agent delete` (for example optional archive-before-delete).
5. Final `configure orchestrator` managed file schema and endpoint auth model.
6. richer provider-aware mind setup beyond Ollama tag listing (non-Ollama model discovery contract).
