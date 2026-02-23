#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgValue, parseArgValues, hasFlag, parseTruthy } from "./cli_args.mjs";
import {
  blockMarkers,
  escapeRegex,
  renderManagedBlock,
  planManagedUpsert,
  extractManagedBlock
} from "./managed_blocks.mjs";
import {
  buildChannelPollCalendarBlock,
  buildChannelInputCalendarBlock,
  buildChannelProduceCalendarBlock,
  stripAgentChannelScheduleText,
  stripLegacySingleChannelScheduleText,
  scrubLegacyMatrixChannelSeed,
  extractChannelPollVectorForAgent,
  upsertChannelPollCalendarText
} from "./matrix_schedule.mjs";
import {
  readText,
  pathExists,
  detectProjectRoot,
  resolveRootDirFromArgs,
  ensureDirForFile
} from "./fs_paths.mjs";
import {
  normalizeHomeserver,
  isAppserviceMode,
  sanitizeMatrixLocalpart,
  matrixUserIdFromLocalpart,
  matrixLocalpartFromUserId,
  normalizeMatrixUserIdentity,
  matrixUsersMatch,
  resolveAgentMatrixUserId,
  homeserverHost,
  matrixSupportsSharedSecret,
  matrixServerFromId,
  ensureMatrixIdServer,
  rewriteMatrixIdServer,
  ensureMatrixUserServer,
  redactText,
  redactMatrixConfig,
  normalizeMatrixMode,
  stripYamlScalarQuotes,
  parseTopLevelYamlScalars,
  resolveConfigPath,
  readMatrixAppserviceRegistration
} from "./matrix_helpers.mjs";
import {
  loginMatrixWithPassword,
  matrixWhoAmI,
  matrixVersions,
  matrixJoinRoom,
  matrixSendRoomMessage,
  matrixInviteRoomMember,
  matrixCreateDirectRoom
} from "./matrix_api.mjs";
import { runNodeScript, runCodexAccountCommand } from "./process_exec.mjs";
import { codexCommand } from "./codex_cli.mjs";
import { createCalendarCommand } from "./calendar_command.mjs";
import { createChannelCommand } from "./channel_command.mjs";
import {
  normalizeIntervalMinutes as normalizeIntervalMinutesImpl,
  upsertAgentRuntime as upsertAgentRuntimeImpl,
  bindAgentToDefaultChannel as bindAgentToDefaultChannelImpl,
  bootstrapAgentMatrixChannelConnection as bootstrapAgentMatrixChannelConnectionImpl,
  upsertAgentDirectoryLicense as upsertAgentDirectoryLicenseImpl,
  upsertAgentChannelSchedule as upsertAgentChannelScheduleImpl
} from "./configure_agent_runtime.mjs";
import { createConfigureAgentCommand } from "./configure_agent_command.mjs";
import { createConfigureMindCommand } from "./configure_mind_command.mjs";
import { createVerifyCommand } from "./verify_command.mjs";
import { createAgentCommand } from "./agent_command.mjs";
import { projectCodexRunToPyash } from "./agent_codex_projection.mjs";
import {
  MIND_BACKEND_CHOICES,
  canonicalizeMindBackend,
  findMindBackendChoice,
  resolveMindBackendSource,
  resolveMindBackendSelection,
  backendChoiceKey,
  displayMindBackendKey,
  relayMatchesBackendSource,
  formatNumberedRows,
  resolveModelSelection
} from "./mind_backend_helpers.mjs";
import { createConfigureMindSupport } from "./configure_mind_support.mjs";
import { createConfigureOrchestratorCommand } from "./configure_orchestrator_command.mjs";
import { createConfigureMenu } from "./configure_menu.mjs";
import { createConfigureAudioCommand } from "./configure_audio_command.mjs";
import {
  createNormalizeChannelAgentName,
  isEphemeralRootDir,
  createResolveConfiguredAgentHouse,
  createResolveConfiguredAgentHouseFromRoot,
  sectionPrinter as createSectionPrinter
} from "./main_runtime_helpers.mjs";
import {
  usage as buildUsage,
  jsonOut,
  textOut,
  quoteText,
  buildOrchestratorConfigureBlock as buildOrchestratorConfigureBlockImpl,
  buildAgentChannelConductBlock as buildAgentChannelConductBlockImpl,
  parseMapBlock,
  createLoadOrchestratorConfigFromSecret,
  applyWritePlan as applyWritePlanImpl,
  writePlanSummary,
  createConfigureChannelList,
  renderShortPreview
} from "./main_helpers.mjs";
import { createMatrixState } from "./configure_matrix_state.mjs";
import { matrixDoctor as matrixDoctorImpl } from "./configure_matrix_doctor.mjs";
import { createMatrixWritePlan as createMatrixWritePlanImpl } from "./configure_matrix_write_plan.mjs";
import { createMatrixDoctorRunner, createMatrixWritePlanner } from "./configure_matrix_runtime.mjs";
import { createConfigureMatrixCommand } from "./configure_matrix_command.mjs";
import {
  ensureMatrixCredentials,
  ensureMatrixExecutiveDmRoom,
  readMatrixAuthCache,
  writeMatrixAuthCache
} from "../../program/agent/channels/bootstrap.mjs";
import { establishAgent, beginAgent, stopAgent, listAgents } from "../../program/agent/admin.mjs";
import { schedulerBegin, schedulerStop, schedulerRestart, schedulerHealth, schedulerList } from "../../program/agent/scheduler_control.mjs";
import { discoverScheduledJobs } from "../../program/agent/scheduler.mjs";
import { isServiceEnabled } from "../../program/agent/scheduler_service_control.mjs";
import { resolveWorldAgentHouseDirectory } from "../../program/library/agent_command_policy.mjs";
import { loadChannelPolicyWithGlobal } from "../../program/agent/channels/policy.mjs";
import { parse } from "../../program/understand/index.mjs";
import { sentenceToPyash } from "../../program/beautiful.mjs";
import { enqueueCliInbound } from "../../program/agent/channels/cli.mjs";
import {
  claimOldestProduceEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail
} from "../../program/agent/channel_core/queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const installRoot = path.resolve(path.dirname(__filename), "..", "..");
const runProgramPath = path.join(installRoot, "command", "run_pya_program.mjs");
const replPath = path.join(installRoot, "program", "main.mjs");
const codexAccountPath = path.join(installRoot, "command", "codex_account.mjs");

const MATRIX_CATERER_NAME = "matrix";
const MATRIX_BLOCK_NAME = "matrix channel";
const CHANNEL_CONFIG_BLOCK_NAME = "channel configure";
const MATRIX_POLICY_BLOCK_NAME = "matrix channel conduct";
const MATRIX_WORLD_POLICY_BLOCK_NAME = "matrix channel world conduct";
const ORCHESTRATOR_CONFIG_BLOCK_NAME = "orchestrator configure";
const MIND_CONFIG_BLOCK_NAME = "mind configure";
const MIND_RELAYS_BLOCK_NAME = "mind relays";
const MIND_DEFAULTS_BLOCK_NAME = "mind defaults";
const DEFAULT_CHANNEL_AGENT_NAME = "pyash-agent";
const DEFAULT_MIND_RELAY_NAME = "default";
const MATRIX_CHANNEL_MODES = ["poll", "sync", "appservice-push", "appservice"];
const DEFAULT_MATRIX_CHANNEL_MODE = "poll";
const DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS = 10;
const DEFAULT_MATRIX_APPSERVICE_REGISTRATION = "configure/secret/matrix.yaml";

const usage=()=>buildUsage({DEFAULT_MATRIX_APPSERVICE_REGISTRATION});
const buildOrchestratorConfigureBlock=(cfg)=>buildOrchestratorConfigureBlockImpl(cfg,quoteText);
const buildAgentChannelConductBlock=(cfg)=>buildAgentChannelConductBlockImpl(cfg,quoteText);
const normalizeChannelAgentName = createNormalizeChannelAgentName({
  sanitizeMatrixLocalpart,
  matrixLocalpartFromUserId
});
const resolveConfiguredAgentHouse=createResolveConfiguredAgentHouse({resolveWorldAgentHouseDirectory});
const resolveConfiguredAgentHouseFromRoot=createResolveConfiguredAgentHouseFromRoot({resolveConfiguredAgentHouse});
const sectionPrinter=()=>createSectionPrinter(textOut);

const matrixState = createMatrixState({
  readText,
  extractManagedBlock,
  parseMapBlock,
  normalizeMatrixMode,
  DEFAULT_MATRIX_CHANNEL_MODE,
  DEFAULT_CHANNEL_AGENT_NAME,
  MATRIX_BLOCK_NAME,
  CHANNEL_CONFIG_BLOCK_NAME,
  loadChannelPolicyWithGlobal,
  resolveConfiguredAgentHouse,
  normalizeHomeserver,
  MATRIX_CHANNEL_MODES,
  isAppserviceMode,
  matrixSupportsSharedSecret,
  homeserverHost,
  matrixServerFromId,
  loginMatrixWithPassword,
  matrixWhoAmI,
  matrixVersions,
  ensureMatrixCredentials,
  resolveConfiguredAgentHouseFromRoot,
  ensureMatrixExecutiveDmRoom,
  matrixJoinRoom,
  matrixSendRoomMessage,
  matrixCreateDirectRoom,
  readMatrixAppserviceRegistration,
  redactMatrixConfig,
  matrixUserIdFromLocalpart,
  matrixUsersMatch,
  resolveAgentMatrixUserId,
  matrixInviteRoomMember,
  backendChoiceKey,
  MIND_CONFIG_BLOCK_NAME,
  MIND_RELAYS_BLOCK_NAME,
  DEFAULT_MIND_RELAY_NAME
});

const {
  loadMatrixConfigFromSecret,
  loadMatrixPolicyConfig,
  loadMatrixConfigureDefaults,
  loadMindConfigFromSecret,
  matrixVerification,
  matrixLiveTest,
  ensureSharedSecretToken,
  ensureExecutiveDmRoom,
  matrixPostSetupTest,
  applyAppserviceAuthDefaults
} = matrixState;

const loadOrchestratorConfigFromSecret = createLoadOrchestratorConfigFromSecret({
  readText,
  extractManagedBlock,
  ORCHESTRATOR_CONFIG_BLOCK_NAME
});

const matrixDoctor = createMatrixDoctorRunner({
  matrixDoctorImpl,
  DEFAULT_CHANNEL_AGENT_NAME,
  loadMatrixConfigureDefaults,
  ensureSharedSecretToken,
  matrixVerification,
  isAppserviceMode,
  readMatrixAppserviceRegistration,
  matrixLiveTest,
  redactMatrixConfig
});

const matrixConfigureCommand = createConfigureMatrixCommand({
  resolveRootDirFromArgs,
  hasFlag,
  parseArgValue,
  parseArgValues,
  parseTruthy,
  normalizeHomeserver,
  homeserverHost,
  ensureMatrixIdServer,
  rewriteMatrixIdServer,
  ensureMatrixUserServer,
  normalizeMatrixMode,
  isAppserviceMode,
  sanitizeMatrixLocalpart,
  matrixLocalpartFromUserId,
  normalizeChannelAgentName,
  loadMatrixConfigureDefaults,
  matrixVerification,
  readMatrixAppserviceRegistration,
  applyAppserviceAuthDefaults,
  redactMatrixConfig,
  loginMatrixWithPassword,
  ensureSharedSecretToken,
  matrixPostSetupTest,
  createMatrixWritePlan,
  establishAgent,
  schedulerRestart,
  applyWritePlan,
  writePlanSummary,
  readMatrixAuthCache,
  writeMatrixAuthCache,
  resolveConfiguredAgentHouseFromRoot,
  matrixDoctor,
  matrixLiveTest,
  matrixVersions,
  matrixSupportsSharedSecret,
  matrixUserIdFromLocalpart,
  DEFAULT_MATRIX_APPSERVICE_REGISTRATION,
  DEFAULT_MATRIX_CHANNEL_MODE,
  DEFAULT_CHANNEL_AGENT_NAME,
  MATRIX_CHANNEL_MODES,
  sectionPrinter,
  pathExists,
  ensureMatrixExecutiveDmRoom,
  matrixSendRoomMessage,
  isEphemeralRootDir,
  renderShortPreview,
  jsonOut,
  textOut
});

const {
  configureMatrix,
  configureMatrixTest,
  configureMatrixDoctor
} = matrixConfigureCommand;

const matrixWritePlanner = createMatrixWritePlanner({
  createMatrixWritePlanImpl,
  readText,
  planManagedUpsert,
  resolveConfiguredAgentHouseFromRoot,
  scrubLegacyMatrixChannelSeed,
  stripLegacySingleChannelScheduleText,
  stripAgentChannelScheduleText,
  buildChannelPollCalendarBlock,
  buildChannelInputCalendarBlock,
  buildChannelProduceCalendarBlock,
  normalizeMatrixMode,
  DEFAULT_MATRIX_CHANNEL_MODE,
  MATRIX_CATERER_NAME,
  MATRIX_BLOCK_NAME,
  CHANNEL_CONFIG_BLOCK_NAME,
  MATRIX_WORLD_POLICY_BLOCK_NAME,
  MATRIX_POLICY_BLOCK_NAME,
  DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS
});

async function createMatrixWritePlan(args){return await matrixWritePlanner(args);}
async function applyWritePlan(plan){await applyWritePlanImpl(plan,ensureDirForFile);}
const configureChannelList = createConfigureChannelList({ MATRIX_CATERER_NAME, jsonOut, textOut });

const calendarCommand = createCalendarCommand({
  resolveRootDirFromArgs,
  hasFlag,
  parseArgValue,
  schedulerHealth,
  schedulerBegin,
  schedulerStop,
  schedulerRestart,
  schedulerList,
  discoverScheduledJobs,
  isServiceEnabled,
  sentenceToPyash,
  readText,
  jsonOut,
  textOut
});

const channelCommand = createChannelCommand({
  resolveRootDirFromArgs,
  hasFlag,
  parseArgValue,
  runNodeScript,
  installRoot,
  DEFAULT_CHANNEL_AGENT_NAME,
  normalizeChannelAgentName,
  bootstrapAgentMatrixChannelConnection,
  enqueueCliInbound,
  claimOldestProduceEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail,
  readText,
  jsonOut,
  textOut
});

const configureOrchestrator = createConfigureOrchestratorCommand({
  resolveRootDirFromArgs,
  hasFlag,
  parseArgValue,
  parseTruthy,
  isEphemeralRootDir,
  loadOrchestratorConfigFromSecret,
  applyWritePlan,
  writePlanSummary,
  schedulerBegin,
  schedulerStop,
  buildOrchestratorConfigureBlock,
  ORCHESTRATOR_CONFIG_BLOCK_NAME,
  readText,
  planManagedUpsert,
  sectionPrinter,
  renderShortPreview,
  jsonOut,
  textOut
});

const configureMindSupport = createConfigureMindSupport({
  parseArgValue,
  parseTruthy,
  normalizeHomeserver,
  quoteText,
  sectionPrinter,
  textOut,
  DEFAULT_MIND_RELAY_NAME,
  runCodexAccountCommand,
  codexAccountPath
});

const {
  collectMindFromFlags,
  collectMindInteractive,
  mindVerification,
  mindLiveTest,
  buildMindConfigureBlock,
  buildMindRelaysBlock,
  buildMindDefaultsBlock
} = configureMindSupport;

const configureMind = createConfigureMindCommand({
  resolveRootDirFromArgs,
  hasFlag,
  parseArgValue,
  parseTruthy,
  loadMindConfigFromSecret,
  collectMindFromFlags,
  collectMindInteractive,
  mindVerification,
  mindLiveTest,
  runCodexAccountCommand,
  codexAccountPath,
  applyWritePlan,
  writePlanSummary,
  buildMindRelaysBlock,
  buildMindConfigureBlock,
  buildMindDefaultsBlock,
  readText,
  planManagedUpsert,
  backendChoiceKey,
  renderShortPreview,
  DEFAULT_MIND_RELAY_NAME,
  MIND_RELAYS_BLOCK_NAME,
  MIND_CONFIG_BLOCK_NAME,
  MIND_DEFAULTS_BLOCK_NAME,
  jsonOut,
  textOut
});

const configureAudio = createConfigureAudioCommand({
  resolveRootDirFromArgs,
  hasFlag,
  parseArgValue,
  parseTruthy,
  readText,
  parseMapBlock,
  extractManagedBlock,
  planManagedUpsert,
  applyWritePlan,
  writePlanSummary,
  renderShortPreview,
  quoteText,
  jsonOut,
  textOut
});

const normalizeIntervalMinutes = normalizeIntervalMinutesImpl;

const upsertAgentRuntime = async (args) => await upsertAgentRuntimeImpl({ ...args, resolveConfiguredAgentHouse, readText, planManagedUpsert, ensureDirForFile });
const bindAgentToDefaultChannel = async (args) => await bindAgentToDefaultChannelImpl({ ...args, loadMatrixConfigureDefaults, resolveConfiguredAgentHouse, resolveAgentMatrixUserId, normalizeMatrixMode, defaultMatrixChannelMode: DEFAULT_MATRIX_CHANNEL_MODE, matrixPolicyBlockName: MATRIX_POLICY_BLOCK_NAME, buildAgentChannelConductBlock, readText, planManagedUpsert, ensureDirForFile });

async function bootstrapAgentMatrixChannelConnection(args) {
  return await bootstrapAgentMatrixChannelConnectionImpl({ ...args, loadMatrixConfigureDefaults, normalizeMatrixMode, defaultMatrixChannelMode: DEFAULT_MATRIX_CHANNEL_MODE, resolveConfiguredAgentHouse, resolveAgentMatrixUserId, matrixUsersMatch, ensureMatrixCredentials, matrixJoinRoom, matrixInviteRoomMember, loadChannelPolicyWithGlobal, ensureMatrixExecutiveDmRoom });
}

const upsertAgentDirectoryLicense = async (args) => await upsertAgentDirectoryLicenseImpl({ ...args, readText, planManagedUpsert, ensureDirForFile });
const upsertAgentChannelSchedule = async (args) => await upsertAgentChannelScheduleImpl({ ...args, resolveConfiguredAgentHouse, readText, stripAgentChannelScheduleText, planManagedUpsert, ensureDirForFile, buildChannelPollCalendarBlock, matrixCatererName: MATRIX_CATERER_NAME });

const configureAgent = createConfigureAgentCommand({ resolveRootDirFromArgs, hasFlag, parseArgValue, parseTruthy, readText, pathExists, resolveConfiguredAgentHouse, isEphemeralRootDir, loadMindConfigFromSecret, loadMatrixConfigureDefaults, parseMapBlock, blockMarkers, escapeRegex, extractManagedBlock, normalizeIntervalMinutes, canonicalizeMindBackend, DEFAULT_CHANNEL_AGENT_NAME, MATRIX_POLICY_BLOCK_NAME, MIND_BACKEND_CHOICES, findMindBackendChoice, resolveMindBackendSource, resolveMindBackendSelection, backendChoiceKey, displayMindBackendKey, relayMatchesBackendSource, formatNumberedRows, resolveModelSelection, sectionPrinter, establishAgent, beginAgent, stopAgent, listAgents, upsertAgentRuntime, upsertAgentDirectoryLicense, bindAgentToDefaultChannel, upsertAgentChannelSchedule, bootstrapAgentMatrixChannelConnection, renderShortPreview, quoteText, jsonOut, textOut });

const { configureMenu } = createConfigureMenu({ resolveRootDirFromArgs, hasFlag, listAgents, pathExists, resolveConfiguredAgentHouse, loadMatrixConfigureDefaults, DEFAULT_CHANNEL_AGENT_NAME, loadMindConfigFromSecret, configureMatrix, configureMatrixTest, configureMatrixDoctor, MATRIX_CATERER_NAME, configureChannelList, configureAudio, configureMind, configureAgent, configureOrchestrator, textOut, jsonOut });
const verifyCommand = createVerifyCommand({ resolveRootDirFromArgs, hasFlag, parseArgValue, jsonOut, textOut });
const agentCommand = createAgentCommand({
  resolveRootDirFromArgs,
  resolveConfiguredAgentHouse,
  pathExists,
  codexCommand,
  projectCodexRunToPyash,
  installRoot,
  textOut
});

export async function main() {
  const args=process.argv.slice(2);
  const first=args[0] ?? "";
  if (!first || first === "--help" || first === "-h" || first === "help") return void textOut(usage());
  if (first === "run") return void process.exit(await runNodeScript(runProgramPath, args.slice(1)));
  if (first === "repl") return void process.exit(await runNodeScript(replPath, []));
  if (first === "configure") return void await configureMenu(args.slice(1));
  if (first === "calendar") return void await calendarCommand(args.slice(1));
  if (first === "channel") return void await channelCommand(args.slice(1));
  if (first === "codex") return void process.exit(await codexCommand(args.slice(1), { installRoot }));
  if (first === "agent") return void process.exit(await agentCommand(args.slice(1)));
  if (first === "verify") return void await verifyCommand(args.slice(1));
  const code=await runNodeScript(runProgramPath,args);
  process.exit(code);
}
