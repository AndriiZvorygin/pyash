export function selectAgendaPreviewCoverPath({
  drawCompleted = false,
  stablePath = "",
  preferredPath = "",
  isFreshFile = () => false,
} = {}) {
  if (!drawCompleted) return "";
  if (stablePath && isFreshFile(stablePath)) return stablePath;
  if (preferredPath && isFreshFile(preferredPath)) return preferredPath;
  return "";
}
