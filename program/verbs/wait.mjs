import { remember } from "../remember/index.mjs";
import { appendWorldActivity, isWorldToolsActive, resolveWorldAgent, resolveWorldPlace, resolveWorldPlaceDir } from "../library/world.mjs";

export async function wait(sentence, { remember: rememberFn = remember } = {}) {
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
          be: "wait"
        }
      });
    }
  }
  return { be: "wait" };
}

export default wait;

export const signatures = [
  { signatureWords: ["be", "wait"], handler: wait }
];
