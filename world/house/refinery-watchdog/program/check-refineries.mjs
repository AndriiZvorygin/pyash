#!/usr/bin/env node
import { PIPELINE_LOCK, REPORTERS, isLockHeld, probeReporter } from "./watchdog-lib.mjs";

const globalActive = isLockHeld(PIPELINE_LOCK);
const results = [];
for (const reporter of Object.values(REPORTERS)) {
  if (globalActive) {
    results.push({
      reporter: reporter.key,
      label: reporter.label,
      state: "active",
      needs_repair: false,
      reason: "shared municipal reporter pipeline lock is held",
    });
  } else {
    results.push(await probeReporter(reporter, { refresh: true, stream: false }));
  }
}
process.stdout.write(`${JSON.stringify({ checked_at_utc: new Date().toISOString(), global_active: globalActive, reporters: results }, null, 2)}\n`);
process.exit(results.some((result) => result.needs_repair) ? 1 : 0);
