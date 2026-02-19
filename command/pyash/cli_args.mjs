export function parseArgValue(args, flag) {
  const idx = args.findIndex((arg) => arg === flag);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

export function parseArgValues(args, flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== flag) continue;
    values.push(args[i + 1] ?? "");
  }
  return values;
}

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function parseTruthy(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(truth|true|yes|1|y)$/i.test(String(value).trim());
}
