export const TRANSLATION_REFINERY_STAGE_ORDER = Object.freeze([
  "read source",
  "segment source",
  "translate sentences",
  "refine senses",
  "review vocabulary",
  "refine compounds",
  "render translation",
  "lower vliw",
  "write outputs"
]);

export const TRANSLATION_REFINERY_STAGE_INPUTS = Object.freeze({
  "read source": [],
  "segment source": ["read source"],
  "translate sentences": ["read source", "segment source"],
  "refine senses": ["translate sentences"],
  "review vocabulary": ["refine senses"],
  "refine compounds": ["review vocabulary"],
  "render translation": ["refine compounds"],
  "lower vliw": ["render translation"],
  "write outputs": ["lower vliw", "render translation"]
});

const ACCEPTED_WORDNET_STATUSES = new Set([
  "accepted-existing",
  "accepted-edge",
  "accepted-deterministic",
  "accepted-llm"
]);

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function stageIndex(stage) {
  const index = TRANSLATION_REFINERY_STAGE_ORDER.indexOf(stage);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function outputArtifact(checkpoint) {
  const map = checkpoint?.resultSentence?.ob?.map;
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

function wordnetLinkStatus(record) {
  return ACCEPTED_WORDNET_STATUSES.has(text(record?.status)) ? "linked" : "pending";
}

function pendingSenseLinks(artifact) {
  const translation = artifact?.translation;
  const records = translation?.wordnet?.records;
  if (!Array.isArray(records)) return [];
  return records
    .filter((record) => wordnetLinkStatus(record) === "pending")
    .map((record) => ({
      id: text(record?.id),
      occurrenceId: text(record?.occurrenceId),
      sourceRecordId: text(record?.sourceRecordId),
      tokenIndex: Number.isInteger(record?.tokenIndex) ? record.tokenIndex : null,
      surface: text(record?.surface),
      status: text(record?.status),
      selectionStatus: text(record?.selectionStatus),
      selectedSenseId: text(record?.selectedSenseId),
      selectedSenseWord: text(record?.selectedSense?.lemma)
        || text(record?.selectedSense?.lemmas?.[0])
        || text(record?.surface),
      selectedSense: record?.selectedSense ?? null,
      anchorCandidates: Array.isArray(record?.anchorCandidates)
        ? record.anchorCandidates
        : [],
      error: text(record?.error),
      providerResponse: text(record?.providerResponse)
    }));
}

function stageArtifact(stage, checkpoint, priorByName) {
  const artifact = outputArtifact(checkpoint);
  const inputArtifacts = {};
  for (const inputName of TRANSLATION_REFINERY_STAGE_INPUTS[stage] ?? []) {
    const prior = priorByName.get(inputName);
    if (prior) inputArtifacts[inputName] = prior.outputArtifact;
  }
  return {
    stage,
    hash: text(checkpoint?.hash),
    resultLine: text(checkpoint?.resultLine),
    outputArtifact: artifact,
    inputArtifacts,
    outputNames: Object.keys(artifact).sort()
  };
}

export function inspectTranslationRefineryArtifacts({
  checkpointIndex,
  refineryName = "translation source vliw"
} = {}) {
  const checkpoints = checkpointIndex?.get?.(refineryName);
  if (!(checkpoints instanceof Map)) {
    return {
      refinery: refineryName,
      stages: [],
      latestStage: null,
      pendingSenseLinks: [],
      counts: { stages: 0, pendingSenseLinks: 0 }
    };
  }
  const entries = [...checkpoints.entries()]
    .filter(([stage, checkpoint]) => text(stage) && checkpoint?.resultSentence)
    .sort(([left], [right]) => stageIndex(left) - stageIndex(right) || left.localeCompare(right));
  const stages = [];
  const stagesByName = new Map();
  for (const [stage, checkpoint] of entries) {
    const artifact = stageArtifact(stage, checkpoint, stagesByName);
    stages.push(artifact);
    stagesByName.set(stage, artifact);
  }
  const latestStage = stages.at(-1) ?? null;
  const pending = pendingSenseLinks(latestStage?.outputArtifact);
  return {
    refinery: refineryName,
    stages,
    latestStage: latestStage?.stage ?? null,
    pendingSenseLinks: pending,
    counts: {
      stages: stages.length,
      pendingSenseLinks: pending.length
    }
  };
}
