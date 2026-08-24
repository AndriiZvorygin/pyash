import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { resolveWorldAgentHouseDirectory } from "../library/agent_command_policy.mjs";
import { worldNewspaperLogPath } from "../agent/newspaper_log.mjs";
import { router } from "./router.mjs";
import {
  createFixtureMailAdapter,
  classifyFixtureMailWithPyash,
  fixtureMailSourceIdentity,
  fixtureMailTaskId,
  readFixtureMailRecord,
  recordFixtureMailArtifactLinks,
  runFixtureMailWorkflow
} from "../agent/channels/fixture_mail.mjs";
import {
  runChannelPollOnce,
  runChannelInputOnce
} from "../agent/channels/index.mjs";
import { projectHeadquartersBriefingInput } from "../agent/headquarters/briefing.mjs";
import { readWorkTaskStatus } from "../runtime/work/status.mjs";
import { findWorkTaskEnvelope } from "../runtime/work/queue.mjs";
import { workTaskStatusDir } from "../runtime/work/status.mjs";

const CHANNEL_TYPE = "fixture-mail";
const DEFAULT_OWNER = "correspondence worker";

function valueText(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.filename ?? value.text ?? value.name ?? value.wo ?? "").trim();
}

function resolveManagedPath(raw, worldRoot) {
  const value = valueText(raw);
  if (!value) return "";
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(worldRoot, value);
}

function resultMap(workflow, poll, input, briefing, artifactLinks = []) {
  const task = workflow?.task ?? {};
  const escalation = task.escalation ?? {};
  const source = task.source ?? {};
  const fields = {
    "task id": workflow?.taskId,
    classification: workflow?.classification,
    "source identity": workflow?.sourceIdentity,
    "router payload id": workflow?.routerPayloadId,
    owner: task.owner,
    domain: task.domain,
    deadline: task.deadline,
    "escalation target": escalation.target,
    "escalation reason": escalation.reason,
    "source locator": source.locator,
    "work reused": workflow?.reused ? "truth" : "lie",
    "poll enqueued": poll?.enqueued,
    "input handled": input?.handled,
    "briefing visible": briefing.some(candidate => candidate.taskId === workflow?.taskId) ? "truth" : "lie",
    "briefing source locator": workflow?.briefing?.sourceLocator,
    "channel input path": poll?.queuedPaths?.[0],
    "channel success path": input?.completedPaths?.[0],
    "work envelope path": workflow?.workEnvelopePath,
    "task status path": workflow?.taskStatusPath,
    "artifact paths": JSON.stringify(workflow?.artifactPaths ?? []),
    "artifact links": JSON.stringify(artifactLinks)
  };
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, { text: String(value ?? "") }])
  );
}

export async function headquarters(sentence, { remember: rememberFn = remember } = {}) {
  const worldRoot = resolveWorldRoot({ rememberFn });
  if (!worldRoot) throw new Error("headquarters fixture mail requires world root");
  const fixturePath = resolveManagedPath(sentence?.from, worldRoot);
  const policyPath = resolveManagedPath(sentence?.with, worldRoot);
  const owner = valueText(sentence?.for) || DEFAULT_OWNER;
  const inboxIdentity = valueText(sentence?.as);
  if (!fixturePath || !policyPath || !owner || !inboxIdentity) {
    throw new Error("headquarters fixture mail requires fixture, policy, owner, and inbox identity");
  }

  const agentHouse = resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName: owner,
    includeFallback: true
  }) ?? path.join(worldRoot, "house", owner);
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  const adapter = createFixtureMailAdapter({
    fixturePath,
    policyPath,
    inboxIdentity,
    worldRoot
  });
  const channelConfig = {
    user: inboxIdentity,
    warmStart: false,
    roomLanes: { [inboxIdentity]: `${CHANNEL_TYPE}_${inboxIdentity}` }
  };
  const poll = await runChannelPollOnce({
    agentName: owner,
    channelType: CHANNEL_TYPE,
    channelConfig,
    adapter,
    agentHouse
  });
  let workflow = null;
  const input = await runChannelInputOnce({
    agentName: owner,
    channelType: CHANNEL_TYPE,
    channelConfig,
    adapter,
    agentHouse,
    concurrency: 1,
    propagateInterpretErrors: true,
    interpretFn: async (routedSentence, { channelProcessingContext } = {}) => {
      workflow = await runFixtureMailWorkflow({
        channelProcessingContext,
        worldRoot,
        fixturePath,
        policyPath,
        owner
      });
      return { ob: { text: "fixture mail work recorded" }, be: "text" };
    },
    routerInterpretFn: routerSentence => router(routerSentence, { remember: rememberFn })
  });
  const briefing = await projectHeadquartersBriefingInput(worldRoot);
  if (!workflow) {
    const record = await readFixtureMailRecord({ fixturePath, inboxIdentity });
    const taskId = fixtureMailTaskId(record);
    const task = await readWorkTaskStatus(worldRoot, taskId);
    if (!task) throw new Error("headquarters fixture mail did not resolve an event");
    const workEnvelopePath = (await findWorkTaskEnvelope(worldRoot, taskId))?.path || "";
    const taskStatusPath = path.join(await workTaskStatusDir(worldRoot), `${taskId}.pya`);
    workflow = {
      taskId,
      classification: await classifyFixtureMailWithPyash(record, policyPath),
      sourceIdentity: fixtureMailSourceIdentity(record),
      routerPayloadId: task.source.routerPayloadId,
      reused: true,
      task,
      briefing: briefing.find(candidate => candidate.taskId === taskId),
      workEnvelopePath,
      taskStatusPath,
      artifactPaths: [
        worldNewspaperLogPath({ worldRoot, name: "headquarters-fixture-mail", now: new Date(task.source.receivedAt) }),
        worldNewspaperLogPath({ worldRoot, name: "channel-fixture-mail-correspondence-worker" }),
        worldNewspaperLogPath({ worldRoot, name: `work-${taskId}` }),
        taskStatusPath,
        workEnvelopePath
      ].filter(Boolean)
    };
  }
  const artifactLinks = await recordFixtureMailArtifactLinks({
    worldRoot,
    taskId: workflow.taskId,
    at: workflow.task?.source?.receivedAt,
    artifactPaths: [
      ...(workflow.artifactPaths ?? []),
      ...(poll.queuedPaths ?? []),
      ...(input.completedPaths ?? [])
    ]
  });
  return {
    ob: { map: resultMap(workflow, poll, input, briefing, artifactLinks) },
    be: "map"
  };
}

export default headquarters;

export const signatures = [
  {
    signatureWords: [
      "be", "headquarters", "as", "text", "for", "text", "from", "filename",
      "to", "name", "map", "with", "filename"
    ],
    handler: headquarters
  },
  {
    signatureWords: [
      "be", "headquarters", "as", "text", "for", "name", "text", "from", "filename",
      "to", "name", "map", "with", "filename"
    ],
    handler: headquarters
  }
];
