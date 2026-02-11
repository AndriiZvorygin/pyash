import {
  assertInputResultSentence,
  assertProduceResultSentence,
  buildRouterInputRequestSentence,
  buildRouterProduceRequestSentence
} from "./channel_core/contract.mjs";

export async function routeChannelInput({
  routerInterpretFn,
  channelType,
  event,
  targetAgentName,
  sessionName
} = {}) {
  const sentence = buildRouterInputRequestSentence({
    channelType,
    event,
    targetAgentName,
    sessionName
  });
  const result = await routerInterpretFn(sentence);
  assertInputResultSentence(result);
  return result;
}

export async function routeChannelProduce({
  routerInterpretFn,
  channelType,
  event,
  sourceAgentName,
  payloadId,
  responseText
} = {}) {
  const sentence = buildRouterProduceRequestSentence({
    channelType,
    event,
    sourceAgentName,
    payloadId,
    responseText
  });
  const result = await routerInterpretFn(sentence);
  assertProduceResultSentence(result);
  return result;
}
