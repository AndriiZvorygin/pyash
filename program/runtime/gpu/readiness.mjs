import { readGpuHandleStatus } from "./handle_status.mjs";
import { normalizeDependencyHandles } from "./contract.mjs";

function text(value) {
  return String(value ?? "").trim();
}
export async function gpuEnvelopeDependencyStatus(worldRoot, envelope = {}) {
  const handles = normalizeDependencyHandles(envelope.dependsOnHandles);
  if (!handles.length) {
    return { ready: true, status: "ready", dependencies: [] };
  }

  const dependencies = [];
  for (const handleId of handles) {
    const handle = await readGpuHandleStatus(worldRoot, handleId);
    const status = text(handle?.status).toLowerCase();
    const satisfied = status === "success";
    dependencies.push({
      handleId,
      status: status || "missing",
      satisfied
    });
  }
  const unmet = dependencies.filter((dependency) => !dependency.satisfied);
  return {
    ready: unmet.length === 0,
    status: unmet.length === 0 ? "ready" : "dependency-waiting",
    dependencies,
    unmet,
    reason: unmet.length
      ? `waiting for GPU handle${unmet.length === 1 ? "" : "s"}: ${unmet.map((item) => `${item.handleId} (${item.status})`).join(", ")}`
      : "all GPU dependencies succeeded"
  };
}
