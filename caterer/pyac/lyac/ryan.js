#!/usr/bin/env node
import { queryRyan } from "./program/ryan.mjs";

const input = process.argv[2];
if (!input) {
  console.error("usage: node ryan.js <prefix>");
  process.exit(1);
}

const lines = await queryRyan(input);
process.stdout.write(lines.join("\n"));
});
