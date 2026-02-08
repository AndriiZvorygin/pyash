// Shared bridge execution state
export const state = {
  lastCondition: true,
  pendingCondition: null,
  definitionStack: [],
  mapStack: [],
  currentEvoke: null,
  currentEvokeRef: null,
  executingBody: false,
  loopActive: false,
  loopControl: null,
  currentSourceFilename: null,
  currentSourceLine: null,
  currentSourceSentence: null
};
