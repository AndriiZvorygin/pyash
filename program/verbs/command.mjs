import { command } from "./command/command.mjs";

// The command verb is one concern with many parts: the text is classified
// apart from the sandbox that holds it, the policy that decides it, the audit
// that records it and the execution that runs it. Those parts live in
// `program/verbs/command/`; this file is the entry the rest of the
// repository imports.
export { command };
export { classifyCommandText } from "../library/command_policy.mjs";
export { resolveCommandPolicy } from "./command/policy.mjs";
export { signatures } from "./command/command.mjs";

export default command;
