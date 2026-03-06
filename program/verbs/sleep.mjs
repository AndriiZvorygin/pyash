import { remember } from "../remember/index.mjs";
import { appendWorldActivity, isWorldToolsActive, resolveWorldAgent, resolveWorldPlace, resolveWorldPlaceDir } from "../library/world.mjs";

export async function sleep(sentence, { remember: rememberFn = remember } = {}) {
  // Sleep is a durable lifecycle phase request used for consolidation work
  // (memory compaction, review, LoRA/training preparation), not a short pause.
  rememberFn({
    mood: "ya",
    su: { name: "world sleep requested" },
    at: { date: new Date().toISOString() },
    be: "sleep"
  });

  if (isWorldToolsActive({ rememberFn })) {
    const agent = resolveWorldAgent({ rememberFn }) ?? "agent";
    const place = resolveWorldPlace({ rememberFn }) ?? "commons";
    const placeDir = resolveWorldPlaceDir(place, { rememberFn });
    if (placeDir) {
      await appendWorldActivity({
        placeDir,
        sentence: {
          mood: "ya",
          su: { name: agent },
          at: { date: new Date().toISOString() },
          be: "sleep"
        }
      });
    }
  }
  return { be: "sleep" };
}

export default sleep;

export const signatures = [
  { signatureWords: ["be", "sleep"], handler: sleep }
];
