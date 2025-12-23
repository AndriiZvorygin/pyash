import { remember } from "../remember/index.mjs";

// Resolve "this" references inside a ceremony to fields on the current evoke sentence.
// Supports patterns like:
//   su name acc ob this ob be number ya
// Returns an object suitable to use as the bound value (e.g., { num: 5 }).
export function resolveThisValue(target, evoke) {
  if (!target) return null;
  const reg = target.thisRef;
  const isThis = target.name === "this" || reg;
  if (!isThis || !reg || !evoke) return null;
  return evoke[reg] ?? evoke.this?.[reg] ?? null;
}

// No-op placeholder for future storage if needed.
export function storeEvokeFrame(_evoke) {
  return null;
}
