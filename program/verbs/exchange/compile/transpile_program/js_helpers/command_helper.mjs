export function commandHelperSource() {
  return `function pyaCommand(cmd, input) {\n  if (typeof process !== \"undefined\" && process.env?.PYA_COMMAND_RESPONSE !== undefined) {\n    return String(process.env.PYA_COMMAND_RESPONSE ?? \"\");\n  }\n  const res = child_process.spawnSync(String(cmd ?? \"\"), {\n    shell: true,\n    input: input ?? undefined,\n    encoding: \"utf8\",\n    maxBuffer: 1024 * 1024\n  });\n  if (res.error || res.status) {\n    throw new Error(\"command defective\");\n  }\n  return String(res.stdout ?? \"\");\n}`;
}
