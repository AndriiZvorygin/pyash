export function createMatrixDoctorRunner(deps) {
  const {
    matrixDoctorImpl,
    DEFAULT_CHANNEL_AGENT_NAME,
    loadMatrixConfigureDefaults,
    ensureSharedSecretToken,
    matrixVerification,
    isAppserviceMode,
    readMatrixAppserviceRegistration,
    matrixLiveTest,
    redactMatrixConfig
  } = deps;
  return async function matrixDoctor({ rootDir }) {
    return await matrixDoctorImpl({
      rootDir,
      DEFAULT_CHANNEL_AGENT_NAME,
      loadMatrixConfigureDefaults,
      ensureSharedSecretToken,
      matrixVerification,
      isAppserviceMode,
      readMatrixAppserviceRegistration,
      matrixLiveTest,
      redactMatrixConfig
    });
  };
}

export function createMatrixWritePlanner(deps) {
  const {
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
  } = deps;

  return async function createMatrixWritePlan({ rootDir, cfg }) {
    return await createMatrixWritePlanImpl({
      rootDir,
      cfg,
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
      defaultMatrixChannelMode: DEFAULT_MATRIX_CHANNEL_MODE,
      matrixCatererName: MATRIX_CATERER_NAME,
      matrixBlockName: MATRIX_BLOCK_NAME,
      channelConfigBlockName: CHANNEL_CONFIG_BLOCK_NAME,
      matrixWorldPolicyBlockName: MATRIX_WORLD_POLICY_BLOCK_NAME,
      matrixPolicyBlockName: MATRIX_POLICY_BLOCK_NAME,
      defaultChannelPollIntervalSeconds: DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS
    });
  };
}
