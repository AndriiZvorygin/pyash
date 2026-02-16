#!/usr/bin/env node
import { main } from "./pyash/main.mjs";

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
