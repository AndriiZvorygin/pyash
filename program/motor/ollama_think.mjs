// Whether a mind backend should be asked to reason before it answers.
//
// A thinking model reasons first and answers second. Ollama returns the
// reasoning in a field of its own, `thinking`, and when the reasoning fills the
// token budget it returns `response` empty with `done_reason: "length"`. A
// caller that reads only `response` sees nothing: the answer arrived, and it was
// all reasoning.
//
// So this is a decision, not a default. The caller's payload says what it wants,
// the house's setting says what the house wants, and a caller that has not asked
// is answered without reasoning. Reasoning is worth its cost for a question that
// benefits from it; it is not worth it for a stage that needs a line of text.

const TRUTHY = /^(true|truth|yes|on|1)$/iu;

/**
 * Read one of the house's truth words, or nothing.
 */
function asThinking(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return TRUTHY.test(value.trim());
  return undefined;
}

/**
 * Whether to ask this model to reason.
 *
 * The payload's own `think` is the caller speaking, and wins. The house's
 * setting is the environment, `PYA_MIND_THINK`. A caller that says neither is
 * answered without reasoning.
 */
export function describeThink({ think, env = process.env } = {}) {
  const fromPayload = asThinking(think);
  if (fromPayload !== undefined) return fromPayload;
  const fromHouse = asThinking(env?.PYA_MIND_THINK);
  if (fromHouse !== undefined) return fromHouse;
  return false;
}
