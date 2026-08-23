import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pyaFileToJson } from "../../library/pya_to_json.mjs";
import { listWorkTasks } from "./operator.mjs";
import { resolveWorkRoleConfig } from "./supervisor.mjs";
import {
  resumeCodexThread,
  runCodexTurn,
  spawnCodexAppServer,
  startCodexThread,
  threadIdFromResponse
} from "../codex/app_server.mjs";

const ROADMAP_PACKAGES = Object.freeze([
  {
    taskId: "roadmap-translation-parity-tranche",
    title: "Complete the higher-level translation parity tranche",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Higher-level translation paths parity",
    whyMatters: "Completes the accepted interpreter/JavaScript ceremony boundary while keeping the deferred C boundary explicit.",
    dependencies: ["stable ceremony signature and return semantics"],
    scope: "Top-level multi-word ceremonies, signature-first binding, isolated call frames, this/ret propagation, repeated calls, interpreter/JavaScript parity tests and goldens.",
    nonGoals: "Nested or dynamic definitions, recursion, closures, imports, C parity, and general translator refactoring.",
    acceptance: "The selected capability works end-to-end in the interpreter and JavaScript backend; focused parity tests, wrong-signature guards, and goldens pass; the supported boundary is documented.",
    priority: 130,
    prompt: "Complete one bounded higher-level translation parity tranche across the current interpreter and JavaScript paths, with the corresponding golden and regression coverage.",
    whyNow: "Accepted on automation/roadmap; the remaining C parity is a separate explicitly deferred boundary."
  },
  {
    taskId: "roadmap-hnuc-compositional-validation",
    title: "Add HNUC compositional-case validation",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Add hnuc/code validation utilities for compositional cases",
    whyMatters: "Turns the compositional case table into executable validation so parser, signatures, compiler, and vocabulary cannot drift silently.",
    dependencies: ["compositionalCases.mjs", "sentence grammar specification"],
    scope: "HNUC/code validation utilities, case-grid coverage, deterministic diagnostics, and focused parser/signature regression tests.",
    nonGoals: "Inventing new compositional keywords or replacing the canonical case table.",
    acceptance: "The validator checks the canonical compositional grid and catches missing/invalid axis-context mappings with deterministic tests and operator-readable output.",
    priority: 125,
    prompt: "Finish the existing HNUC/code validation worktree, preserve the explicit unassigned identity warnings, and obtain focused Sol-reviewed acceptance.",
    whyNow: "The isolated worktree has a real validator and 28 passing focused tests; recover and review it before starting unrelated work."
  },
  {
    taskId: "roadmap-ceremony-error-propagation",
    title: "Complete ceremony and sandpit error propagation",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Add error-handling paths for ceremonies/sandpits",
    whyMatters: "Reliable autonomous work needs truthful errors to cross ceremony boundaries without losing source context or result shape.",
    dependencies: ["accepted ceremony translation boundary", "error sentence contract"],
    scope: "ret with be error, nested and returned ceremony errors, surfaced main-memory/results behavior, and supported parity coverage.",
    nonGoals: "A new exception system, undocumented error names, or broad compiler redesign.",
    acceptance: "Ceremony and sandpit errors become truthful Pyash error sentences, propagate through supported paths, and focused nested/returned error tests pass.",
    priority: 120,
    prompt: "Finish the existing ceremony error-propagation worktree and obtain Sol review; retain the supported interpreter/JavaScript boundary and do not broaden into a new exception system.",
    whyNow: "The timeout left a focused implementation with 7 passing tests in its worktree, so this is retryable correctness work rather than a direction question."
  },
  {
    taskId: "roadmap-register-state-ground-truth",
    title: "Remove separate register-fact reliance",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Remove reliance on separate register facts",
    whyMatters: "Keeps the evoking sentence as the source of truth and reduces stale fromindex/toindex state during loops and resumed work.",
    dependencies: ["loop semantics", "evoke sentence result contract"],
    scope: "Derive register lookups from the evoking sentence, preserve observable loop behavior, and add interpreter/JavaScript/C parity guards where supported.",
    nonGoals: "Removing legitimate result facts or changing the public loop vocabulary.",
    acceptance: "Loop and ceremony paths no longer depend on stale separate register facts; existing loop behavior and backend parity remain green.",
    priority: 115,
    prompt: "Finish the existing register-state worktree and obtain Sol review, preserving evoking-sentence authority and the current loop vocabulary.",
    whyNow: "The isolated worktree has passing interpreter/JavaScript/C loop regressions and documentation changes; it is valid retryable WIP."
  },
  {
    taskId: "roadmap-mind-reply-envelope-streaming",
    title: "Complete mind reply envelopes and streaming parity",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Mind: plus streaming path and richer reply envelopes",
    whyMatters: "Makes mind calls useful as a durable language/runtime primitive by preserving assistant, thinking, timestamp, and streaming evidence.",
    dependencies: ["current mind contract", "translation/runtime parity baseline"],
    scope: "Richer reply envelope mapping, Ollama streaming path, supported interpreter/JavaScript surfaces, durable success/failure tests, and aligned documentation.",
    nonGoals: "New providers, multi-host scheduling, UI work, and fixture-only behavior.",
    acceptance: "Mind replies preserve text, metadata, and streaming behavior through supported runtime paths; focused success/failure tests pass without fixture-only backends.",
    priority: 110,
    prompt: "Finish the existing mind reply/streaming worktree, fix the failing delayed-terminal streaming assertion, and obtain focused Sol review without re-planning.",
    whyNow: "The timeout left a substantial reply module and tests; one focused streaming test still fails, so the package is partial and retryable."
  },
  {
    taskId: "roadmap-pyash-native-agent-workflows",
    title: "Strengthen Pyash-native agent workflows",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Next milestone: Agent harness (research + builder)",
    whyMatters: "Exercises Pyash itself as the workflow language and improves the agent/runtime substrate that operates the roadmap.",
    dependencies: ["mind reply envelopes", "agent session and scheduler contracts", "tool/MCP lifecycle"],
    scope: "One end-to-end Pyash-defined agent workflow using existing session, tool, newspaper, and command primitives, with a durable example and tests.",
    nonGoals: "Replacing the supervisor, adding parallel workers, or inventing a second agent framework.",
    acceptance: "A bounded agent workflow is expressed in Pyash where reasonable, runs through supported runtime primitives, records durable evidence, and has zero-quota tests.",
    priority: 105,
    prompt: "Recover the existing accepted-looking native agent workflow commit, verify its durable example and zero-quota tests, then obtain Sol review before integration.",
    whyNow: "The worktree contains commit 65325b78 and passing agent workflow tests, but the durable task record missed the result because the turn timed out."
  },
  {
    taskId: "roadmap-standard-verb-coverage",
    title: "Expand standard verb and noun coverage",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Expand verb coverage with quizzes for additional nouns/classes",
    whyMatters: "Builds language capability from tested vocabulary instead of adding runtime behavior without a stable surface contract.",
    dependencies: ["signature-first dispatch", "filename IO contract"],
    scope: "Complete the filename mutation family across interpreter, JavaScript, and C, then retain a frozen contract and runnable example.",
    nonGoals: "A speculative standard library expansion or untested vocabulary aliases.",
    acceptance: "Touch, copy, rename, and file-mode delete have matching interpreter/JS/C behavior, guards, signatures, and focused parity tests.",
    priority: 100,
    prompt: "Recover the filename mutation worktree, fix the three reported parity/code-generation failures, and obtain Sol review without broadening the noun family.",
    whyNow: "The timeout left meaningful implementation and tests, but focused validation still has three failures; it is partial retryable work."
  },
  {
    taskId: "roadmap-cli-language-ux",
    title: "Strengthen CLI language UX",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Strengthen CLI UX",
    whyMatters: "Makes the language executable and inspectable for humans without requiring knowledge of internal wrapper conventions.",
    dependencies: ["current compile/run/interpret commands", "CLI contract tests"],
    scope: "Document case-parsed compile/run/interpret arguments, add smoke coverage for the wrappers, and keep command output/error contracts explicit.",
    nonGoals: "A new CLI framework or a broad flag/alias compatibility layer.",
    acceptance: "The documented CLI forms work from a clean checkout, focused smoke tests cover success and error paths, and command contracts are clear.",
    priority: 95,
    prompt: "Recover the CLI language UX worktree and obtain Sol review for the existing wrapper documentation and 8 passing smoke tests.",
    whyNow: "The isolated worktree has a complete-looking command helper and passing focused tests, but no durable review result was captured."
  },
  {
    taskId: "roadmap-agent-research-tool-chain",
    title: "Complete the Pyash agent research tool chain",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Goal: runnable agent loop with search, download, read-to-markdown, tool-calling minds, and project command execution.",
    whyMatters: "Turns the separate search, download, markdown, command, and mind primitives into one useful user-facing agent capability.",
    dependencies: ["native agent command workflow", "mind reply envelopes", "search/download/read tool contracts"],
    scope: "A Pyash-defined research workflow that searches, downloads, reads to markdown, and records durable tool/session/newspaper evidence.",
    nonGoals: "Browser automation, arbitrary web crawling, new providers, and a second agent framework.",
    acceptance: "A fixture-free local end-to-end example exercises the supported tool chain with bounded policy and durable evidence; focused tests cover success and typed failure paths.",
    priority: 90,
    prompt: "Implement one Pyash-first research workflow using the existing search, download, read-to-markdown, mind, session, and newspaper primitives, with bounded policy and evidence.",
    whyNow: "The individual capabilities exist, but the roadmap's runnable agent loop is not yet proven as one coherent workflow."
  },
  {
    taskId: "roadmap-product-alpha-soak",
    title: "Prove the product-alpha scheduler and Matrix runtime",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Goal: ship a narrow but reliable multi-agent runtime for real users (single workspace, scheduler + Matrix + file/tool workflows).",
    whyMatters: "Converts the existing scheduler/channel code into an evidence-backed product-alpha claim instead of relying on unit tests alone.",
    dependencies: ["agent research workflow", "Matrix channel contract", "scheduler health and dedup"],
    scope: "A bounded real-environment alpha validation tranche: Matrix intake/produce, scheduler operation, dedup/checkpoint behavior, three real task traces, and a seven-day soak runbook/evidence summary.",
    nonGoals: "Multi-host deployment, arbitrary parallel workers, and UI/dashboard redesign.",
    acceptance: "The alpha exit evidence exists: seven-day soak without manual restart, three real end-to-end tasks, green scheduler/channel/agent tests, and a daily real-backend smoke record.",
    priority: 85,
    prompt: "Design and execute the smallest evidence-backed product-alpha reliability tranche around the existing Matrix and scheduler runtime; record external prerequisites and do not fake soak evidence.",
    whyNow: "The code and tests exist, but the roadmap exit criteria have not been demonstrated."
  },
  {
    taskId: "hq-organization-and-work-contract",
    title: "Define Headquarters organization and work contracts",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-organization-and-work-contract",
    whyMatters: "Gives the Headquarters vertical slice durable roles, delegation context, and domain-aware work without creating parallel registries or queues.",
    dependencies: ["agent administration", "durable WorkTask contract", "Knowledge Core provenance direction"],
    scope: "Extend existing agent administration and WorkTask records with role, supervisor, responsibilities, domain, source, deadline, dependencies, delegation, and escalation metadata; record delegation lifecycle events over existing statuses.",
    nonGoals: "A second agent registry, work queue, permissions system, or provider-neutral organizational runtime.",
    acceptance: "Chief of Staff and Correspondence Worker roles can be represented by existing agent houses, and one domain-aware delegated work record round-trips through existing checkpoint, retry, and newspaper paths.",
    priority: 72,
    prompt: "Implement the P0 Headquarters organization and work-contract extension over existing agent administration and WorkTask primitives; do not create replacement registries or queues.",
    whyNow: "This is the smallest Headquarters foundation and must precede fixture-mail routing and approval resumption."
  },
  {
    taskId: "hq-fixture-mail-vertical-slice",
    title: "Prove the Headquarters fixture-mail vertical slice",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-fixture-mail-vertical-slice",
    whyMatters: "Exercises the real channel spool/router, Correspondence Worker routing, durable work, escalation, and replay guarantees in one useful application scenario.",
    dependencies: ["hq-organization-and-work-contract", "channel_core input contract", "newspaper and replay"],
    scope: "Fixture email adapter over channel_core, provider/event/message identity, information/work/draft/escalation classification, Chief of Staff escalation, idempotent duplicate delivery, restart recovery, and briefing input evidence.",
    nonGoals: "A standalone inbox queue, competing message envelope, live provider integration, or Headquarters UI.",
    acceptance: "A duplicate-safe fixture email becomes recoverable organizational work, escalates with provenance, and is visible to the briefing projection with a complete replayable newspaper record.",
    priority: 71,
    prompt: "Build the P0 Headquarters fixture-mail slice over existing channel_core and WorkTask paths, proving duplicate delivery and restart recovery without parallel queues.",
    whyNow: "It is the first end-to-end application proof and depends on the organization/work metadata contract."
  },
  {
    taskId: "hq-approval-and-resumption",
    title: "Add Headquarters approval and checkpoint resumption",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-approval-and-resumption",
    whyMatters: "Connects existing ratification decisions to durable organizational work so sensitive actions pause safely and resume without replaying completed work.",
    dependencies: ["hq-fixture-mail-vertical-slice", "ratify policy", "durable work checkpoints"],
    scope: "Durable approval requests referencing work, proposed action, and checkpoint; approval/denial newspaper evidence; send, delete, purchase, publish, and calendar-mutation gates; checkpoint-based resumption.",
    nonGoals: "A separate permissions engine, hidden approval state, or unrestricted external action path.",
    acceptance: "Standing policy permits or denies configured actions, unapproved sensitive actions remain paused, and an approved task resumes from its durable checkpoint with replayable evidence.",
    priority: 70,
    prompt: "Extend ratify policy and durable WorkTask checkpoints for Headquarters approval and resumption; preserve existing conduct and newspaper contracts.",
    whyNow: "Approval is the safety boundary required before the Correspondence Worker can become useful beyond read-only classification."
  },
  {
    taskId: "hq-chief-briefing",
    title: "Project the Chief of Staff daily briefing",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-chief-briefing",
    whyMatters: "Turns canonical Pyash work, approval, channel, deadline, and escalation state into a concise operator view without introducing another database.",
    dependencies: ["hq-fixture-mail-vertical-slice", "hq-approval-and-resumption", "canonical newspaper/replay records"],
    scope: "Deterministic maximum-five ranking of decisions, imminent deadlines, overdue commitments, conflicts, waiting responses, and escalations with source-record links.",
    nonGoals: "An authoritative briefing database, opaque model-only ranking, or a full Headquarters UI.",
    acceptance: "A briefing is derived from canonical Pyash state, stays replayable/auditable, and includes the golden fixture-mail escalation with its source evidence.",
    priority: 69,
    prompt: "Implement the P0 Chief of Staff briefing as a deterministic projection over existing agent, work, channel, approval, and newspaper state.",
    whyNow: "This closes the P0 vertical slice and gives humans a useful, inspectable result."
  },
  {
    taskId: "hq-email-and-capability-boundaries",
    title: "Extend Headquarters email and capability boundaries",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-email-and-capability-boundaries",
    whyMatters: "Moves from fixture evidence toward safe real-world operation by reusing channel contracts and unifying existing conduct boundaries.",
    dependencies: ["hq-chief-briefing", "channel/router contracts", "directory licences and ratification"],
    scope: "Provider-neutral email adapter, concrete Gmail/IMAP boundary where available, and coherent capability checks across files, tools, channels, domains, and action classes.",
    nonGoals: "A competing envelope abstraction, permissions system, or broad unattended email mutation.",
    acceptance: "A real adapter can preserve channel identity and apply the existing capability/ratification policies, with Correspondence Worker mutation remaining narrowly scoped.",
    priority: 58,
    prompt: "Extend the existing channel and conduct policy contracts for safe Headquarters email operation; keep provider adapters thin and policy centralized.",
    whyNow: "The P0 fixture proves routing; this package makes the same path ready for carefully bounded real providers."
  },
  {
    taskId: "hq-contacts-commitments-knowledge-alignment",
    title: "Align Headquarters contacts and commitments with Knowledge Core",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-contacts-commitments-knowledge-alignment",
    whyMatters: "Makes organizational relationships and commitments useful without fragmenting provenance or claim identity.",
    dependencies: ["Knowledge Core claim identity and evidence shell", "hq-organization-and-work-contract"],
    scope: "Contact, organization, relationship, and commitment records linked to work, dates, domains, and source evidence using Knowledge Core identity, confidence, and anchor concepts.",
    nonGoals: "A competing CRM, relationship database, or provenance schema.",
    acceptance: "Commitments can reference people, organizations, dates, work, and source evidence while remaining compatible with Knowledge Core replay and conflict views.",
    priority: 57,
    prompt: "Extend the Knowledge Core concepts for Headquarters contacts and commitments; do not invent a separate provenance model.",
    whyNow: "This is the P1 data alignment needed before cross-domain coordination can be trusted."
  },
  {
    taskId: "hq-state-api-and-2d-projection",
    title: "Project Headquarters state through a read-only API",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-state-api-and-2d-projection",
    whyMatters: "Makes organizational state visible while keeping Pyash records authoritative and preventing a duplicate simulation.",
    dependencies: ["hq-chief-briefing", "hq-contacts-commitments-knowledge-alignment", "Product alpha runtime"],
    scope: "Read-only projection of agents, relationships, work, channel queues, approvals, domains, newspaper events, and initial mailroom/Chief of Staff/domain workspace activity states.",
    nonGoals: "An authoritative UI database, speculative avatar simulation, or broad dashboard redesign.",
    acceptance: "API and initial 2D projection reproduce canonical state transitions for waiting, claimed, active, handoff, escalation, approval wait, and completion.",
    priority: 52,
    prompt: "Build a read-only Headquarters state projection over canonical Pyash records, with no duplicate organizational state machine.",
    whyNow: "Visualization should follow a proven P0/P1 state model and Product alpha channel/runtime contracts."
  },
  {
    taskId: "hq-temporary-workers-and-workload-evaluation",
    title: "Add bounded Headquarters temporary workers and evaluation",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "hq-temporary-workers-and-workload-evaluation",
    whyMatters: "Lets sustained coordination demand inform safe organizational scaling without silently restructuring agent administration.",
    dependencies: ["hq-state-api-and-2d-projection", "agent/session/work machinery", "scheduler telemetry"],
    scope: "Bounded temporary assignments with context, domain, capabilities, resource budget, termination condition, workload recommendations, watchdog checks, and resource accounting by agent/task/project/domain.",
    nonGoals: "Arbitrary parallel workers, automatic persistent-agent creation, or a second scheduler/telemetry system.",
    acceptance: "Temporary work is bounded and auditable, evaluator findings use newspaper/work/provenance evidence, and recommendations remain explicit rather than automatic restructuring.",
    priority: 51,
    prompt: "Extend existing agent/session/work machinery for bounded Headquarters temporary workers and workload evaluation; reuse scheduler telemetry and preserve explicit human control.",
    whyNow: "This is the final scaling package after the application state and safety projections are proven."
  },
  {
    taskId: "roadmap-session-replay-hardening",
    title: "Harden long-run session replay and context compaction",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Session behavior hardening for long runs",
    whyMatters: "Makes agent work resumable and keeps prompt context bounded as real workflows span many turns.",
    dependencies: ["agent session contract", "newspaper/artifact replay", "mind reply envelopes"],
    scope: "Accepted retry-pair compaction, stable session records, replay-safe checkpoints, and deterministic context-window tests.",
    nonGoals: "Model training, arbitrary memory retrieval, and parallel session execution.",
    acceptance: "Long sessions compact deterministically, preserve accepted evidence, resume without duplicate turns, and pass replay/fixture-free regression coverage.",
    priority: 80,
    prompt: "Complete a bounded long-run session/replay hardening package using the existing session, checkpoint, newspaper, and artifact contracts.",
    whyNow: "The roadmap marks session hardening partial, and durable autonomous work has already exposed the cost of ambiguous long turns."
  },
  {
    taskId: "roadmap-command-result-identity",
    title: "Add durable per-command result identity",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Introduce result tracking with per-command IDs instead of generic result",
    whyMatters: "Improves debugging and replay when one Pyash program performs several external commands or tool calls.",
    dependencies: ["command audit IDs", "newspaper/tool event ordering", "result artifact contract"],
    scope: "A sentence-native result identity contract that links command/tool requests, surfaced results, artifacts, and replay evidence without breaking generic result compatibility.",
    nonGoals: "A new JSON state store, replacing all existing result names at once, or changing backend semantics without parity tests.",
    acceptance: "Repeated commands receive deterministic IDs, their results and artifacts are linked in newspapers, replay preserves identity, and focused interpreter/JS/C tests pass where supported.",
    priority: 75,
    prompt: "Design and implement a small sentence-native per-command result identity layer over the existing audit/newspaper/artifact primitives, with compatibility and parity tests.",
    whyNow: "This later TODO is a direct reliability multiplier for the agent and product-alpha packages."
  },
  {
    taskId: "roadmap-review-loop-compaction",
    title: "Complete review-loop context compaction",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Review-loop context compaction (golden context)",
    whyMatters: "Keeps repeated implementation and review cycles bounded while preserving accepted evidence for replay.",
    dependencies: ["durable work checkpoints", "session replay records"],
    scope: "Original objective plus latest accepted success pair in live prompts, failed retry chains retained in newspapers/artifacts, and deterministic compaction goldens.",
    nonGoals: "Provider-specific context heuristics, arbitrary memory retrieval, or multi-worker concurrency.",
    acceptance: "Repeated review loops produce bounded deterministic context, preserve accepted evidence, and replay without duplicating obsolete retry history.",
    priority: 70,
    prompt: "Complete the bounded review-loop context compaction package described by the Week 4 roadmap, using existing checkpoint and newspaper evidence.",
    whyNow: "The manager/worker lane already exposes long-turn context pressure; this is a direct reliability prerequisite for unattended work."
  },
  {
    taskId: "roadmap-library-refinement-cache",
    title: "Complete the library refinement cache model",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Library refinement cache model",
    whyMatters: "Avoids repeated expensive refinement work and makes document/tool pipelines replayable and practical.",
    dependencies: ["download cache records", "document digestion evidence"],
    scope: "Fresh/text/abridged/summarized staged roots, content-hash cache hits, deterministic reuse records, and replay tests.",
    nonGoals: "A new storage engine, uncontrolled cache eviction, or provider-specific cache semantics.",
    acceptance: "Unchanged inputs reuse staged outputs with identical artifacts and run records; changed inputs invalidate only the affected stages.",
    priority: 65,
    prompt: "Complete the roadmap library refinement cache model using existing download, artifact, and newspaper conventions, with deterministic cache-hit tests.",
    whyNow: "The research agent and document workflows need predictable cost and replay before they can scale beyond fixtures."
  },
  {
    taskId: "roadmap-concurrency-deterministic-simulation",
    title: "Build deterministic concurrency simulation",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Week 5: Concurrency v0.7 (ready queue, cancellation, backpressure, simulation)",
    whyMatters: "Establishes a testable concurrency contract without making unattended coding multi-worker yet.",
    dependencies: ["scheduler trace events", "stream lifecycle contract", "timeout and cancellation vocabulary"],
    scope: "Fixed-seed simulated clock, deterministic ready-queue ordering, cancellation/timeouts, bounded stream buffering, and newspaper schedule traces.",
    nonGoals: "Arbitrary parallel background coders, production load balancing, or changing the one-worker safety policy.",
    acceptance: "Seeded simulations replay identically across supported backends and surface stable timeout/cancel/backpressure evidence.",
    priority: 60,
    prompt: "Implement the smallest spec-aligned deterministic concurrency simulation slice from Week 5, keeping real background coding single-flight.",
    whyNow: "Scheduler and channel code exist, but the roadmap's deterministic concurrency and simulation gates remain unproven."
  },
  {
    taskId: "roadmap-knowledge-core",
    title: "Implement the sentence-native knowledge core",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Week 9: Knowledge core v0.9 (claim identity, evidence shell, KB layout)",
    whyMatters: "Gives Pyash agent workflows a truthful claim/evidence substrate instead of leaving durable knowledge as generic artifacts.",
    dependencies: ["evidential sentence conventions", "source anchoring", "parity canonical ordering"],
    scope: "Claim-key derivation, evidential shell, source/anchor identity, entity-page layout, registries, held/rejected stores, and current/contested/provenance views.",
    nonGoals: "A hosted database, opaque vector store, or model-dependent truth scoring.",
    acceptance: "Golden claim/evidence/resolver fixtures pass with canonical interpreter/JavaScript/C output for the supported boundary.",
    priority: 55,
    prompt: "Implement a bounded sentence-native knowledge-core slice from Week 9, starting with claim identity and evidence fixtures before broader retrieval.",
    whyNow: "The later research, digestion, and adjudication milestones depend on a durable claim and provenance contract."
  },
  {
    taskId: "roadmap-document-digestion",
    title: "Build anchored document digestion",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Week 10: Document digestion v0.92 (policy ingest to sentences, segmentation, draft extraction)",
    whyMatters: "Moves document conversion from Markdown output toward replayable, sentence-native knowledge input.",
    dependencies: ["knowledge core claim identity", "read-to-markdown", "source artifact anchors"],
    scope: "Source registration, deterministic anchors, sentence segmentation, high-recall draft extraction, normalization, and three golden document fixtures.",
    nonGoals: "Full autonomous truth adjudication, arbitrary OCR, or replacing existing read/download primitives.",
    acceptance: "Policy, technical, and tabular golden documents produce stable anchored candidate sentences and replay-identical records.",
    priority: 50,
    prompt: "Build the smallest Pyash-first anchored document digestion package on top of the existing read and artifact paths, with deterministic golden outputs.",
    whyNow: "Read-to-Markdown is present, but the roadmap's sentence-native ingest and anchoring boundary remains unfinished."
  }
]);

const COMPLETED_PACKAGES = Object.freeze([
  {
    taskId: "language-ret-register-live",
    title: "Complete single-register ceremony ret parity",
    sourcePath: "quiz/definitions.test.mjs",
    sourceAnchor: "ceremony with ret returns updated evoke registers to caller names",
    whyMatters: "Established the first real ceremony return parity increment used by later translation and error work.",
    dependencies: [],
    scope: "Single-register ceremony ret propagation and focused interpreter regression coverage.",
    nonGoals: "Higher-level translation, nested ceremonies, and broader return refactoring.",
    acceptance: "The Sol-reviewed focused regression passes and the accepted task commit is available for automation history.",
    priority: 131
  }
]);

const ROADMAP_SCHEMA = "4";

const OPERATIONAL_BLOCK_PATTERNS = Object.freeze([
  /turn timeout/iu,
  /timed out/iu,
  /sandbox/iu,
  /infrastructure/iu,
  /execution environment/iu,
  /usage[- ]limited/iu,
  /capacity/iu,
  /pacing/iu,
  /provider/iu,
  /app[- ]server/iu,
  /active writer/iu,
  /codex/iu,
  /interrupted/iu,
  /temporary/iu
]);

const TECHNICAL_CONTINUATION_PATTERNS = Object.freeze([
  /revision limit/iu,
  /correction/iu,
  /failing? tests?/iu,
  /test(?:s| suite)? (?:failed|red|blocked)/iu,
  /compiler/iu,
  /runtime/iu,
  /regression/iu,
  /bug/iu,
  /incomplete/iu,
  /missing/iu,
  /incorrect/iu,
  /integration/iu,
  /merge conflict/iu,
  /cherry-pick/iu,
  /rebase/iu,
  /optional .* unavailable/iu,
  /baseline/iu,
  /\b(?:HTTP|status)\s+[45]\d\d\b/iu
]);

const HUMAN_DECISION_PATTERNS = Object.freeze([
  /human (?:decision|input|direction)/iu,
  /requires? (?:a )?(?:human|product|architectural|semantic|safety|policy) (?:decision|choice|direction)/iu,
  /product (?:decision|choice)/iu,
  /architectural (?:decision|choice)/iu,
  /semantic (?:decision|choice)/iu,
  /safety (?:decision|choice)/iu,
  /policy (?:decision|choice)/iu,
  /choose between/iu,
  /incompatible intended semantics/iu
]);

const EXTERNAL_EVIDENCE_PATTERNS = Object.freeze([
  /awaiting external evidence/iu,
  /fixture-free .*?(?:run|evidence).*?(?:unavailable|required)/iu,
  /live .*?(?:service|backend|Ollama).*?(?:unavailable|required)/iu,
  /required service .*? unavailable/iu,
  /required .*?(?:live )?(?:systems?|services?|backends?|environments?).*?(?:unavailable|refus(?:e|es|ed) connections?|not reachable|not available)/iu,
  /\b(?:Ollama|search|Matrix|CI|real[- ]backend|soak)\b.*?(?:unavailable|refus(?:e|es|ed) connections?|not reachable|not available|pending|required)/iu,
  /(?:fixture-free|live).*?(?:proof|evidence).*?(?:HTTP|status)\s+[45]\d\d\b/iu,
  /(?:search|Ollama|Matrix|CI) endpoint.*?(?:HTTP|status)\s+[45]\d\d\b/iu,
  /(?:HTTP|status)\s+[45]\d\d\b.*?(?:required|acceptance|evidence|proof|blocked)/iu
]);

function text(value) {
  return String(value ?? "").trim();
}

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function roadmapPath(worldRoot) {
  return path.join(worldRoot, "holding", "work", "artifacts", "autonomous-roadmap.pya");
}

function roadmapMarkdownPath(worldRoot) {
  return path.join(worldRoot, "holding", "work", "artifacts", "autonomous-roadmap.md");
}

function listField(value) {
  return Array.isArray(value) ? value.join(" | ") : text(value);
}

function fieldEntries(item) {
  return [
    ["task id", item.taskId],
    ["title", item.title],
    ["source", item.source],
    ["source path", item.sourcePath],
    ["source anchor", item.sourceAnchor],
    ["why matters", item.whyMatters],
    ["dependencies", listField(item.dependencies)],
    ["intended scope", item.scope],
    ["non goals", listField(item.nonGoals)],
    ["acceptance", item.acceptance],
    ["priority", item.priority],
    ["status", item.status],
    ["current progress", item.progress],
    ["worktree", item.worktree],
    ["commit", item.commit]
  ];
}

function renderMap(name, entries) {
  return [
    `su name ${name} be map def`,
    ...entries
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `  su name ${key} ob text ${quote(value)} ya`),
    "prah",
    ""
  ].join("\n");
}

function sourceForPackage(item) {
  return item.source || `${item.sourcePath}:${item.sourceAnchor}`;
}

function operationalItems(roadmap) {
  const packageIds = new Set((roadmap.packages || []).map((item) => item.taskId));
  return [
    ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / OPERATIONAL"),
    ...technicalRetryableItems(roadmap).filter((item) => !packageIds.has(item.taskId))
  ];
}

function externalEvidenceItems(roadmap) {
  const packageIds = new Set((roadmap.packages || []).map((item) => item.taskId));
  return [
    ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / EXTERNAL EVIDENCE"),
    ...(roadmap.externalEvidence || []).filter((item) => !packageIds.has(item.taskId))
  ];
}

function taskMatch(item, tasks) {
  return tasks.find((task) => task.taskId === item.taskId)
    || tasks.find((task) => task.workSpec?.provenance?.key === `${item.sourcePath}:${item.sourceAnchor}`);
}

function withoutExternalEvidencePrefix(value) {
  return text(value).replace(/^(?:awaiting external evidence:\s*)+/iu, "");
}

function progressForTask(task) {
  if (!task) return "not started; candidate package";
  if (isArchivedWorkTask(task)) return `superseded/archived: ${text(task.workSpec?.archiveReason) || "operator archived"}`;
  const checkpoint = task.checkpoint || {};
  const passes = Number(checkpoint.implementation?.passes || 0);
  const action = text(checkpoint.lastAction || checkpoint.interruption?.reason);
  if (task.status === "accepted") return `accepted; Sol review ${text(checkpoint.review?.decision) || "complete"}`;
  if (task.status === "blocked" || task.status === "failed") {
    const reason = text(checkpoint.blocker || task.message || task.error) || task.status;
    const classification = isAwaitingExternalEvidence(task)
      ? "awaiting external evidence"
      : isRetryableWorkBlock(task)
        ? "retryable operational block"
        : "human decision block";
    return `${classification}: ${isAwaitingExternalEvidence(task) ? withoutExternalEvidencePrefix(reason) : reason}`;
  }
  if (task.status === "ready") return "queued for the next eligible background wake";
  return `${passes} implementation pass${passes === 1 ? "" : "es"}; ${action || `phase ${task.status}`}`;
}

function statusForTask(task) {
  if (!task) return "CANDIDATE";
  if (isArchivedWorkTask(task)) return "SUPERSEDED / ARCHIVED";
  if (task.status === "accepted") return "COMPLETE";
  if (task.status === "blocked" || task.status === "failed") {
    return isAwaitingExternalEvidence(task)
      ? "BLOCKED / EXTERNAL EVIDENCE"
      : isRetryableWorkBlock(task)
        ? "BLOCKED / OPERATIONAL"
        : "BLOCKED / NEEDS DECISION";
  }
  if (task.status === "ready") return "QUEUED";
  return "ACTIVE";
}

function normalizePackage(item, task) {
  return {
    ...item,
    source: sourceForPackage(item),
    dependencies: Array.isArray(item.dependencies) ? item.dependencies : text(item.dependencies).split(" | ").filter(Boolean),
    nonGoals: Array.isArray(item.nonGoals) ? item.nonGoals : text(item.nonGoals),
    status: statusForTask(task),
    blockClass: isArchivedWorkTask(task)
      ? "superseded"
      : task && (task.status === "blocked" || task.status === "failed")
        ? (isAwaitingExternalEvidence(task)
          ? "external-evidence"
          : isRetryableWorkBlock(task) ? "operational" : "human-decision")
      : "",
    progress: progressForTask(task),
    worktree: text(task?.checkpoint?.workspace?.worktreePath),
    commit: text(task?.checkpoint?.integration?.commit || task?.checkpoint?.implementation?.commit)
  };
}

function taskBlockReason(task) {
  return text(task?.checkpoint?.blocker || task?.message || task?.error);
}

export function isArchivedWorkTask(task) {
  return task?.workSpec?.archived === true
    || ["superseded", "split-parent"].includes(task?.workSpec?.lifecycle);
}

function hasHumanDecisionReason(reason) {
  return HUMAN_DECISION_PATTERNS.some((pattern) => pattern.test(reason));
}

function hasTechnicalContinuationReason(reason) {
  return OPERATIONAL_BLOCK_PATTERNS.some((pattern) => pattern.test(reason))
    || TECHNICAL_CONTINUATION_PATTERNS.some((pattern) => pattern.test(reason));
}

export function isRetryableWorkBlock(task) {
  if (!task || !["blocked", "failed"].includes(task.status) || isArchivedWorkTask(task)) return false;
  const reason = taskBlockReason(task);
  if (isAwaitingExternalEvidence(task)) return false;
  if (["reconciliation", "revision"].includes(task.checkpoint?.integration?.status)) return true;
  if (task.checkpoint?.integration?.status === "integration-blocked") return false;
  if (hasHumanDecisionReason(reason)) return false;
  return hasTechnicalContinuationReason(reason);
}

export function isAwaitingExternalEvidence(task) {
  if (!task || !["blocked", "failed"].includes(task.status) || isArchivedWorkTask(task)) return false;
  const reason = taskBlockReason(task);
  return EXTERNAL_EVIDENCE_PATTERNS.some((pattern) => pattern.test(reason));
}

export function isHumanDecisionBlock(task) {
  if (!task || !["blocked", "failed"].includes(task.status) || isArchivedWorkTask(task)) return false;
  if (isAwaitingExternalEvidence(task)) return false;
  const reason = taskBlockReason(task);
  return hasHumanDecisionReason(reason) || !hasTechnicalContinuationReason(reason);
}

export function isTechnicalContinuationBlock(task) {
  return isRetryableWorkBlock(task);
}

export function hasCredibleRoadmapWork(roadmap = {}) {
  return (roadmap.packages || []).some((item) => ["ACTIVE", "QUEUED", "CANDIDATE", "BLOCKED / OPERATIONAL"].includes(item.status))
    || technicalRetryableItems(roadmap).length > 0;
}

export function technicalRetryableItems(roadmap = {}) {
  return roadmap.retryableTechnical || roadmap.retryable || [];
}

function mapValue(map, key) {
  const node = map?.[key];
  return String(node?.ob?.text ?? "").trim();
}

function mapFromMemory(memory, name) {
  const sentence = (Array.isArray(memory) ? memory : []).find((item) => item?.su?.name === name && item?.be === "map");
  return sentence?.ob?.map || {};
}

function splitList(value) {
  return text(value).split(" | ").filter(Boolean);
}

function packageFromMap(map) {
  return {
    taskId: mapValue(map, "task id"),
    title: mapValue(map, "title"),
    source: mapValue(map, "source"),
    sourcePath: mapValue(map, "source path"),
    sourceAnchor: mapValue(map, "source anchor"),
    whyMatters: mapValue(map, "why matters"),
    dependencies: splitList(mapValue(map, "dependencies")),
    scope: mapValue(map, "intended scope"),
    nonGoals: mapValue(map, "non goals"),
    acceptance: mapValue(map, "acceptance"),
    priority: Number(mapValue(map, "priority")) || 0,
    status: mapValue(map, "status"),
    progress: mapValue(map, "current progress"),
    worktree: mapValue(map, "worktree"),
    commit: mapValue(map, "commit")
  };
}

export function autonomousRoadmapPackages() {
  return ROADMAP_PACKAGES.map((item) => ({ ...item, dependencies: [...item.dependencies] }));
}

export function autonomousCompletedPackages() {
  return COMPLETED_PACKAGES.map((item) => ({ ...item, dependencies: [...item.dependencies] }));
}

export function autonomousRoadmapPaths(worldRoot) {
  return { pya: roadmapPath(worldRoot), markdown: roadmapMarkdownPath(worldRoot) };
}

export function roadmapNeedsRefresh(roadmap) {
  return Boolean(roadmap?.refreshNeeded)
    || (roadmap?.packages || []).filter((item) => item.status === "CANDIDATE").length < 3;
}

export function renderAutonomousRoadmapMarkdown(roadmap = {}) {
  const sections = [
    ["Active", (roadmap.packages || []).filter((item) => item.status === "ACTIVE")],
    ["Queued", (roadmap.packages || []).filter((item) => item.status === "QUEUED")],
    ["Candidate", (roadmap.packages || []).filter((item) => item.status === "CANDIDATE")],
    ["Blocked / Operational", operationalItems(roadmap)],
    ["Blocked / External Evidence", externalEvidenceItems(roadmap)],
    ["Blocked / Needs Decision", [
      ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / NEEDS DECISION"),
      ...(roadmap.needsDecision || [])
    ]],
    ["Complete", [
      ...(roadmap.packages || []).filter((item) => item.status === "COMPLETE"),
      ...(roadmap.completed || [])
    ]]
  ];
  const output = ["# Pyash Autonomous Roadmap", "", `Generated: ${roadmap.generatedAt || "unknown"}`, `Refresh needed: ${roadmap.refreshNeeded ? "yes" : "no"}`, `Refresh reason: ${roadmap.refreshReason || "roadmap has enough credible packages"}`, ""];
  for (const [heading, items] of sections) {
    output.push(`## ${heading}`, "");
    if (!items.length) {
      output.push("_None._", "");
      continue;
    }
    for (const item of items) {
      output.push(`### ${item.title || item.taskId}`, "", `- Task: \`${item.taskId}\``, `- Source: ${item.source || "operator history"}`, `- Priority: ${item.priority ?? ""}`, `- Status: ${item.status || heading.toUpperCase()}`, `- Progress: ${item.progress || ""}`);
      if (item.whyMatters) output.push(`- Why it matters: ${item.whyMatters}`);
      if (item.dependencies?.length) output.push(`- Dependencies: ${listField(item.dependencies)}`);
      if (item.scope) output.push(`- Scope: ${item.scope}`);
      if (item.nonGoals) output.push(`- Non-goals: ${listField(item.nonGoals)}`);
      if (item.acceptance) output.push(`- Acceptance: ${item.acceptance}`);
      if (item.worktree) output.push(`- Worktree: \`${item.worktree}\``);
      if (item.commit) output.push(`- Commit: \`${item.commit}\``);
      output.push("");
    }
  }
  if (roadmap.architect?.summary) output.push("## Last Sol Roadmap Review", "", roadmap.architect.summary, "");
  if (roadmap.architect?.decisions?.length) output.push("### Decisions Needed", "", ...roadmap.architect.decisions.map((item) => `- ${item}`), "");
  return output.join("\n");
}

export function renderAutonomousRoadmapReport(roadmap = {}) {
  const groups = [
    ["ACTIVE", (roadmap.packages || []).filter((item) => item.status === "ACTIVE")],
    ["QUEUED", (roadmap.packages || []).filter((item) => item.status === "QUEUED")],
    ["CANDIDATE", (roadmap.packages || []).filter((item) => item.status === "CANDIDATE")],
    ["BLOCKED / OPERATIONAL", operationalItems(roadmap)],
    ["BLOCKED / EXTERNAL EVIDENCE", externalEvidenceItems(roadmap)],
    ["BLOCKED / NEEDS DECISION", [
      ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / NEEDS DECISION"),
      ...(roadmap.needsDecision || [])
    ]],
    ["COMPLETE", [
      ...(roadmap.packages || []).filter((item) => item.status === "COMPLETE"),
      ...(roadmap.completed || [])
    ]]
  ];
  const lines = [
    "PYASH AUTONOMOUS ROADMAP",
    "",
    `Generated: ${roadmap.generatedAt || "unknown"}`,
    `Refresh needed: ${roadmap.refreshNeeded ? "yes" : "no"}`,
    `Refresh reason: ${roadmap.refreshReason || "roadmap has enough credible packages"}`,
    ""
  ];
  for (const [heading, items] of groups) {
    lines.push(heading, "-".repeat(heading.length));
    if (!items.length) {
      lines.push("(none)", "");
      continue;
    }
    for (const item of items) {
      lines.push(`${item.taskId} [priority ${item.priority}] ${item.title}`, `  progress: ${item.progress || ""}`);
      if (item.source) lines.push(`  source: ${item.source}`);
      if (item.worktree) lines.push(`  worktree: ${item.worktree}`);
      if (item.commit) lines.push(`  commit: ${item.commit}`);
    }
    lines.push("");
  }
  if (roadmap.architect?.summary) {
    lines.push("LAST SOL ROADMAP REVIEW", "------------------------", roadmap.architect.summary, "");
  }
  if (roadmap.architect?.decisions?.length) {
    lines.push("SOL DECISIONS NEEDED", "--------------------", ...roadmap.architect.decisions.map((item) => `- ${item}`), "");
  }
  return lines.join("\n");
}

function renderAutonomousRoadmapPya(roadmap) {
  const header = renderMap("work autonomous roadmap state", [
    ["schema", roadmap.schema || ROADMAP_SCHEMA],
    ["generated at", roadmap.generatedAt],
    ["refresh needed", roadmap.refreshNeeded ? "true" : "false"],
    ["refresh reason", roadmap.refreshReason],
    ["reconciliation source", roadmap.reconciliation?.source || ""],
    ["reconciliation status", roadmap.reconciliation?.status || ""],
    ["last refresh at", roadmap.architect?.refreshedAt || ""],
    ["manager thread id", roadmap.architect?.threadId || ""],
    ["last sol summary", roadmap.architect?.summary || ""]
  ]);
  const packageText = [...(roadmap.packages || []), ...(roadmap.completed || [])]
    .map((item) => renderMap(`work autonomous roadmap package ${item.taskId}`, fieldEntries(item)))
    .join("\n");
  const decisions = renderMap("work autonomous roadmap decisions", (roadmap.needsDecision || []).map((item, index) => [String(index + 1), `${item.taskId}: ${item.blocker || item.progress || item.title}`]));
  const retryable = renderMap("work autonomous roadmap operational blocks", technicalRetryableItems(roadmap).map((item, index) => [String(index + 1), `${item.taskId}: ${item.blocker || item.progress || item.title}`]));
  return `${header}${packageText}${retryable}${decisions}`;
}

export async function readAutonomousRoadmap(worldRoot) {
  const { pya, markdown } = autonomousRoadmapPaths(worldRoot);
  try {
    const payload = await pyaFileToJson(pya, { memoryOnly: false });
    const stateMap = mapFromMemory(payload.memory, "work autonomous roadmap state");
    const packageMaps = (payload.memory || [])
      .filter((item) => item?.be === "map" && String(item?.su?.name || "").startsWith("work autonomous roadmap package "))
      .map((item) => packageFromMap(item.ob?.map || {}))
      .filter((item) => item.taskId);
    const decisionsMap = mapFromMemory(payload.memory, "work autonomous roadmap decisions");
    const decisions = Object.values(decisionsMap).map((item) => String(item?.ob?.text || "")).filter(Boolean);
    return {
      schema: mapValue(stateMap, "schema") || ROADMAP_SCHEMA,
      generatedAt: mapValue(stateMap, "generated at"),
      refreshNeeded: mapValue(stateMap, "refresh needed") === "true",
      refreshReason: mapValue(stateMap, "refresh reason"),
      reconciliation: {
        source: mapValue(stateMap, "reconciliation source"),
        status: mapValue(stateMap, "reconciliation status")
      },
      architect: {
        refreshedAt: mapValue(stateMap, "last refresh at"),
        threadId: mapValue(stateMap, "manager thread id"),
        summary: mapValue(stateMap, "last sol summary"),
        decisions
      },
      packages: packageMaps.filter((item) => !COMPLETED_PACKAGES.some((completed) => completed.taskId === item.taskId)),
      completed: packageMaps.filter((item) => COMPLETED_PACKAGES.some((completed) => completed.taskId === item.taskId)),
      needsDecision: decisions,
      retryableTechnical: [],
      retryable: [],
      externalEvidence: [],
      paths: { pya, markdown }
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
}

export async function writeAutonomousRoadmap(worldRoot, roadmap) {
  const { pya, markdown } = autonomousRoadmapPaths(worldRoot);
  await fs.mkdir(path.dirname(pya), { recursive: true });
  const pyaTemp = `${pya}.tmp-${process.pid}-${Date.now()}`;
  const markdownTemp = `${markdown}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(pyaTemp, renderAutonomousRoadmapPya(roadmap), "utf8");
  await fs.writeFile(markdownTemp, `${renderAutonomousRoadmapMarkdown(roadmap)}\n`, "utf8");
  await fs.rename(pyaTemp, pya);
  await fs.rename(markdownTemp, markdown);
  return { ...roadmap, paths: { pya, markdown } };
}

export async function buildAutonomousRoadmap({
  worldRoot,
  repositoryRoot = process.cwd(),
  tasks = null,
  now = () => new Date(),
  persist = true,
  architect = null
} = {}) {
  const allTasks = tasks || await listWorkTasks(worldRoot, { includeTerminal: true });
  const previous = await readAutonomousRoadmap(worldRoot);
  const persistedCatalog = previous?.schema === ROADMAP_SCHEMA
    ? previous.packages?.filter((item) => item.taskId && item.sourcePath && item.sourceAnchor) || []
    : [];
  const catalog = persistedCatalog.length >= 5 ? persistedCatalog : ROADMAP_PACKAGES;
  const packages = catalog.map((item) => normalizePackage(item, taskMatch(item, allTasks)));
  const completed = COMPLETED_PACKAGES.map((item) => normalizePackage(item, taskMatch(item, allTasks)));
  const operationalBlocks = allTasks
    .filter((task) => isRetryableWorkBlock(task))
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: "BLOCKED / OPERATIONAL",
      priority: task.priority,
      blocker: taskBlockReason(task),
      progress: progressForTask(task),
      worktree: text(task.checkpoint?.workspace?.worktreePath)
    }));
  const externalEvidence = allTasks
    .filter((task) => isAwaitingExternalEvidence(task))
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: "BLOCKED / EXTERNAL EVIDENCE",
      priority: task.priority,
      blocker: taskBlockReason(task),
      progress: progressForTask(task),
      worktree: text(task.checkpoint?.workspace?.worktreePath)
    }));
  const needsDecision = allTasks
    .filter((task) => ["blocked", "failed"].includes(task.status))
    .filter((task) => !isArchivedWorkTask(task))
    .filter((task) => !isRetryableWorkBlock(task))
    .filter((task) => !packages.some((item) => item.taskId === task.taskId))
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: "BLOCKED / NEEDS DECISION",
      priority: task.priority,
      blocker: text(task.checkpoint?.blocker || task.message || task.error),
      progress: progressForTask(task)
    }));
  const storedArchitect = previous?.schema === ROADMAP_SCHEMA ? previous.architect || {} : {};
  const roadmap = {
    schema: ROADMAP_SCHEMA,
    generatedAt: iso(typeof now === "function" ? now() : now),
    refreshNeeded: false,
    refreshReason: "roadmap has enough credible packages",
    packages,
    completed,
    needsDecision,
    retryableTechnical: operationalBlocks,
    retryable: operationalBlocks,
    externalEvidence,
    reconciliation: {
      source: "documentation/reference/roadmap-reconciliation-2026-08.md",
      status: "unfinished roadmap work remains; generated candidates are not exhaustion evidence"
    },
    architect: architect || (storedArchitect.summary || storedArchitect.threadId || storedArchitect.refreshedAt ? storedArchitect : {}),
    repositoryRoot
  };
  roadmap.refreshNeeded = roadmapNeedsRefresh(roadmap);
  if (roadmap.refreshNeeded) roadmap.refreshReason = "fewer than three credible candidate packages remain";
  return persist ? writeAutonomousRoadmap(worldRoot, roadmap) : roadmap;
}

function parseArchitectResponse(output) {
  const raw = text(output);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Sol roadmap refresh did not return a JSON object");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed.packages) || parsed.packages.length < 5 || parsed.packages.length > 8) {
    throw new Error("Sol roadmap refresh must return 5 to 8 substantial packages");
  }
  return parsed;
}

function normalizeArchitectPackage(item, index) {
  const taskId = text(item.taskId) || `roadmap-curated-${index + 1}`;
  return {
    taskId,
    title: text(item.title) || taskId,
    source: text(item.source) || "Sol roadmap review",
    sourcePath: text(item.sourcePath),
    sourceAnchor: text(item.sourceAnchor),
    whyMatters: text(item.whyMatters || item.whyNow),
    dependencies: Array.isArray(item.dependencies) ? item.dependencies.map(text).filter(Boolean) : [],
    scope: text(item.scope),
    nonGoals: text(item.nonGoals),
    acceptance: text(item.acceptance),
    priority: Number(item.priority) || 0,
    prompt: text(item.prompt) || text(item.scope),
    whyNow: text(item.whyNow || item.whyMatters)
  };
}

function roadmapRefreshPrompt(roadmap, repositoryRoot) {
  return [
    "You are Sol, the occasional Pyash roadmap architect.",
    "Inspect the repository, current specs, TODO, tests, and durable work state before proposing the next substantial packages.",
    "Return JSON only with this shape: {summary, decisions, packages:[{taskId,title,source,whyMatters,dependencies,scope,nonGoals,acceptance,priority,prompt,whyNow}] }.",
    "Return 5 to 8 packages. Keep only the first 2 or 3 ready-worthy; the rest are candidates. Prefer coherent language/runtime/parity increments over micro-fixes.",
    "Respect Pyash-first policy: use Pyash for workflow logic when reasonably expressible and state the reason for host-language substrate.",
    `Repository: ${repositoryRoot}`,
    `Current roadmap:\n${JSON.stringify(roadmap.packages)}`,
    `Current needs for human decision:\n${JSON.stringify(roadmap.needsDecision)}`
  ].join("\n");
}

export async function refreshAutonomousRoadmap({
  worldRoot,
  repositoryRoot = process.cwd(),
  appServerFactory = ({}) => spawnCodexAppServer({}),
  roleConfig = {},
  threadSandbox = "workspace-write",
  now = () => new Date(),
  ifNeeded = false
} = {}) {
  const current = await buildAutonomousRoadmap({ worldRoot, repositoryRoot, now, persist: false });
  if (ifNeeded && !roadmapNeedsRefresh(current)) {
    return { status: "not-needed", roadmap: await writeAutonomousRoadmap(worldRoot, current) };
  }
  const roles = resolveWorkRoleConfig({ manager: roleConfig.manager });
  const existingThread = current.architect?.threadId || "";
  const client = await appServerFactory({
    role: "manager",
    model: roles.manager.model,
    reasoningEffort: roles.manager.reasoningEffort,
    cwd: repositoryRoot,
    threadId: existingThread
  });
  try {
    let threadId = existingThread;
    if (threadId) {
      if (typeof client.resumeThread === "function") await client.resumeThread({ threadId, cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox });
      else await resumeCodexThread(client, threadId, { cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox });
    } else {
      const started = typeof client.startThread === "function"
        ? await client.startThread({ role: "manager", cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox })
        : await startCodexThread(client, { cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox });
      threadId = threadIdFromResponse(started);
    }
    if (!threadId) throw new Error("Sol roadmap refresh returned no manager thread id");
    const result = typeof client.runTurn === "function"
      ? await client.runTurn({ threadId, cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, requestIdentity: `pyash-autonomous-roadmap-refresh-${Date.now()}`, input: [{ type: "text", text: roadmapRefreshPrompt(current, repositoryRoot) }] })
      : await runCodexTurn(client, { threadId, cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, requestIdentity: `pyash-autonomous-roadmap-refresh-${Date.now()}`, input: [{ type: "text", text: roadmapRefreshPrompt(current, repositoryRoot) }] });
    const proposal = parseArchitectResponse(result?.text || result?.output || "");
    const packages = proposal.packages.map(normalizeArchitectPackage);
    const refreshedTasks = await listWorkTasks(worldRoot, { includeTerminal: true });
    const refreshed = await buildAutonomousRoadmap({
      worldRoot,
      repositoryRoot,
      now,
      persist: false,
      architect: {
        threadId,
        refreshedAt: iso(typeof now === "function" ? now() : now),
        summary: text(proposal.summary),
        decisions: Array.isArray(proposal.decisions) ? proposal.decisions.map(text).filter(Boolean) : []
      }
    });
    refreshed.packages = packages.map((item) => normalizePackage(item, refreshedTasks.find((task) => task.taskId === item.taskId)));
    refreshed.refreshNeeded = false;
    refreshed.refreshReason = "last Sol roadmap refresh returned a bounded package set";
    const roadmap = await writeAutonomousRoadmap(worldRoot, refreshed);
    return { status: "refreshed", roadmap, proposal };
  } finally {
    await client?.close?.();
  }
}
