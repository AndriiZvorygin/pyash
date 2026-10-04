#!/usr/bin/env node

import { runAuditedLp } from "../program/library/print_audit/lp.mjs";

const code = await runAuditedLp(process.argv.slice(2));
process.exit(code);
