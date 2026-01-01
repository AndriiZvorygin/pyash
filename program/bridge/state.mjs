// Shared bridge execution state
export const state = {
  lastCondition: true,
  definitionStack: [],
  mapStack: [],
  currentEvoke: null,
  currentEvokeRef: null,
  executingBody: false,
  currentSourceFilename: null,
  currentSourceLine: null,
  currentSourceSentence: null
};
