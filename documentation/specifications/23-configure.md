# `23-configure.md`

Status: draft v0.1

Purpose: define a channel-first, caterer-agnostic configuration flow for Pyash.

---

## 1. Scope

This chapter defines:

1. canonical `pyash configure` command routes,
2. interactive configuration UX standards,
3. caterer plugin contract for configuration/test/doctor,
4. deterministic managed writes in `configure/secret.pya`,
5. machine-readable output for automation.

This chapter applies to channel setup for:

- Matrix (initial caterer),
- future caterers (email, telegram, whatsapp, others).

---

## 2. Command contract

Canonical route family:

1. `pyash configure`
2. `pyash configure channel`
3. `pyash configure channel list`
4. `pyash configure channel <caterer>`
5. `pyash configure channel <caterer> test`
6. `pyash configure channel <caterer> doctor`

Examples:

- `pyash configure channel matrix`
- `pyash configure channel matrix --non-interactive --homeserver https://matrix.org --room '#pyash:matrix.org' --auth-mode password --agent-user-id '@mybot:matrix.org' --password '***'`
- `pyash configure channel matrix doctor`

Rules:

1. No compatibility aliases are required by this spec.
2. New caterers MUST be attached under `configure channel <caterer>`.

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
2. Steps MUST be grouped by intent (channel routing vs auth vs conduct).
3. Flow MUST support `quickstart` and `advanced` modes.
4. Quickstart asks minimum required fields only.
5. Advanced exposes optional routing/conduct overrides.

Suggested section groups:

- `A`: Channel routing (caterer endpoint + destination)
- `B`: Caterer auth
- `C`: Agent/channel conduct write targets
- `D`: Test and confirm

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

---

## 6. Verification and test requirements

Verification MUST include:

1. required field presence by caterer,
2. field format checks (URL, channel id, user id, etc.),
3. cross-field checks (for example server/domain consistency),
4. write-target permissions/path existence checks.

`test` command behavior:

1. run caterer live check (auth + destination reachability when possible),
2. return pass/fail and concise diagnosis,
3. no config mutation unless explicitly requested.

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

Test profile:

1. verify auth is accepted,
2. verify target room format and reachability where possible,
3. return clear actionable failure reasons.

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

---

## 11. Open items

1. Final map names for multi-caterer routing conduct in `world/house/<agent>/conduct/channels.pya`.
2. Whether `test` can auto-resolve Matrix alias to room id and persist that normalization.
3. Unified caterer capability matrix output for `configure channel list`.
