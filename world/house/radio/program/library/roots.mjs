// Where this house sits, and where pyash sits above it.
//
// The radio is a house: its own repository, checked out under pyash's
// `world/house/radio/`. It owns its own data — the lanes, the rotation, the
// channels, the catalogue — and it reaches pyash with relative paths for the
// things pyash owns: the interpreter, the configuration surface, the runners
// that call the GPU housekeeper.
//
// Both roots are worked out from this file's own place rather than from the
// directory the command happens to be started in, so a command run from
// anywhere still finds both.

import path from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <house>/program/library/roots.mjs.
const LIBRARY_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The root of the radio house: the folder that holds `radio/`, `command/`. */
export const HOUSE_ROOT = path.resolve(LIBRARY_DIR, "..", "..");

/** The root of the pyash checkout this house is checked out inside. */
export const PYASH_ROOT = path.resolve(HOUSE_ROOT, "..", "..", "..");

/**
 * A path inside the house, from the house root.
 */
export function housePath(...parts) {
  return path.join(HOUSE_ROOT, ...parts);
}

/**
 * A path inside pyash, from the pyash root.
 */
export function pyashPath(...parts) {
  return path.join(PYASH_ROOT, ...parts);
}
