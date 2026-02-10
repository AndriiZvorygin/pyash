export function summarizeParityStatus(status = {}) {
  const run = status?.run ?? {};
  const runjs = status?.runjs ?? {};
  const runc = status?.runc ?? {};
  const parity = status?.parity ?? {};
  return {
    runSuccesses: Array.isArray(run.successes) ? run.successes.length : 0,
    runFailures: Array.isArray(run.failures) ? run.failures.length : 0,
    runTimeouts: Array.isArray(run.timeouts) ? run.timeouts.length : 0,
    runjsSuccesses: Array.isArray(runjs.successes) ? runjs.successes.length : 0,
    runjsFailures: Array.isArray(runjs.failures) ? runjs.failures.length : 0,
    runjsTimeouts: Array.isArray(runjs.timeouts) ? runjs.timeouts.length : 0,
    runcSuccesses: Array.isArray(runc.successes) ? runc.successes.length : 0,
    runcFailures: Array.isArray(runc.failures) ? runc.failures.length : 0,
    runcTimeouts: Array.isArray(runc.timeouts) ? runc.timeouts.length : 0,
    parityGreen: Array.isArray(parity.green) ? parity.green.length : 0,
    parityRed: Array.isArray(parity.red) ? parity.red.length : 0
  };
}

export function selectParityFixCandidates(status = {}) {
  const details = status?.details ?? {};
  const out = [];
  for (const [file, info] of Object.entries(details)) {
    if (info?.run?.status !== "success") continue;
    const jsOk = info?.runjs?.status === "success";
    const cOk = info?.runc?.status === "success";
    if (jsOk && cOk) continue;
    out.push(file);
  }
  return out.sort((a, b) => a.localeCompare(b, "en"));
}

export function computeParityDelta(before = {}, after = {}) {
  const b = summarizeParityStatus(before);
  const a = summarizeParityStatus(after);
  const improved = (a.parityRed < b.parityRed) || (a.parityGreen > b.parityGreen);
  const regressed = (a.parityRed > b.parityRed) || (a.parityGreen < b.parityGreen);
  const unchanged = !improved && !regressed;
  return {
    before: b,
    after: a,
    delta: {
      parityGreen: a.parityGreen - b.parityGreen,
      parityRed: a.parityRed - b.parityRed,
      runFailures: a.runFailures - b.runFailures,
      runjsFailures: a.runjsFailures - b.runjsFailures,
      runcFailures: a.runcFailures - b.runcFailures
    },
    improved,
    regressed,
    unchanged
  };
}
