import { spawn } from "node:child_process";

// The configured command is a small adapter around the official IFEval
// verifier. It receives one JSON request on stdin and returns JSON scores.
export async function runIfevalVerifier({ command, args = [], sample, output, timeoutMs = 120000 } = {}) {
  if (!command) return null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`IFEval verifier timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`IFEval verifier exited ${code}: ${stderr.trim()}`.trim()));
        return;
      }
      try {
        const value = JSON.parse(stdout);
        resolve({
          promptAccuracy: Number(value.prompt_accuracy ?? value.promptAccuracy ?? 0),
          instructionAccuracy: Number(value.instruction_accuracy ?? value.instructionAccuracy ?? 0),
          instructionChecks: value.instruction_checks ?? value.instructionChecks ?? [],
          verifier: command
        });
      } catch (error) {
        reject(new Error(`IFEval verifier returned malformed JSON: ${error.message}`));
      }
    });
    child.stdin.end(JSON.stringify({
      prompt: sample.prompt,
      instruction_id_list: sample.instructionIds ?? [],
      kwargs: sample.kwargs ?? [],
      output
    }));
  });
}
