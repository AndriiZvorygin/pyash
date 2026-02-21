import fs from "node:fs/promises";
import path from "node:path";
import { parseSrtToCuts, renderItineraryPya } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/srt_to_itinerary_pya.mjs <input.srt> <output.pya> [--name <itinerary name>]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) throw new Error(usage());
  const out = {
    input: args[0],
    output: args[1],
    itineraryName: "teaching cuts"
  };
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--name") out.itineraryName = String(args[++i] ?? out.itineraryName);
    else throw new Error(usage());
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  const text = await fs.readFile(opts.input, "utf8");
  const cuts = parseSrtToCuts(text);
  const pya = renderItineraryPya({ itineraryName: opts.itineraryName, cuts });
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  await fs.writeFile(opts.output, pya, "utf8");
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  process.exit(1);
});
