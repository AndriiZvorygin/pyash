import { listWorkTasks } from "../../runtime/work/operator.mjs";

function text(value) {
  return String(value ?? "").trim();
}
export async function projectHeadquartersBriefingInput(worldRoot) {
  const tasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  return tasks
    .filter(task => text(task?.source?.identity))
    .map(task => ({
      taskId: task.taskId,
      owner: task.owner,
      domain: task.domain,
      deadline: task.deadline,
      escalationReason: task.escalation.reason,
      escalationTarget: task.escalation.target,
      sourceLocator: task.source.locator
    }))
    .sort((left, right) => (
      text(left.deadline).localeCompare(text(right.deadline))
      || left.taskId.localeCompare(right.taskId)
    ));
}
