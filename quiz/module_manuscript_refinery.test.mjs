import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runScript } from "./helpers/run_script.mjs";

function countWords(text = "") {
  return String(text ?? "").trim().match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function assertNoUnexpectedErrors(errors = []) {
  const unexpected = errors.filter((line) => {
    const text = String(line);
    return !text.startsWith("artifacts folder: ")
      && !text.startsWith("run start: ")
      && !text.startsWith("run end: ")
      && !text.startsWith("run duration: ");
  });
  assert.deepEqual(unexpected, []);
}

test("module manuscript refinery emits all segments within the requested word bands", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-module-manuscript-"));
  const source = path.join(tmp, "source.txt");
  await fs.writeFile(
    source,
    [
      "Communities stay coherent when people can still tell what they owe each other, what they share, and what they are trying to build together.",
      "When memory breaks, language hardens into slogans, institutions become procedural shells, and people start reacting to fragments instead of whole realities.",
      "A durable public culture needs truthful explanation, repeated moral practice, and patient habits of repair that ordinary people can actually carry."
    ].join("\n\n"),
    "utf8"
  );

  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    { message: { content: "shared memory defines common obligations\nhidden fracture appears when public language loses shared memory\ncivic repair restores trust through repeated truthful practice" } },
    { message: { content: "Shared memory is more than nostalgia. It is the lived record that tells a people what they owe each other, what their institutions are for, and which sacrifices still make sense. When that memory becomes thin, every disagreement feels absolute because no common story remains strong enough to absorb tension. Citizens start treating one another as strangers to be managed instead of neighbors to be answered. Public language shrinks into slogans, and even real problems begin to arrive as disconnected shocks without moral shape or patient interpretation." } },
    { message: { content: "That fracture does not stay inside opinion. It moves into institutions. Offices still open, reports still circulate, meetings still happen, but the connective tissue thins out. Procedures remain while trust drains away. People can no longer tell whether a rule protects the common good or simply preserves a shell. In that vacuum, performance becomes easier than stewardship. Leaders speak in fragments that travel fast, while citizens react to symbols more quickly than they examine causes. The result is not only confusion. It is a slower loss of civic confidence, because fewer people believe anyone remembers the whole purpose anymore." } },
    { message: { content: "Repair begins when a community chooses practices that thicken memory again. Someone has to tell the truth plainly. Someone has to repeat the core obligations until they become speakable and ordinary. Families, congregations, schools, and local institutions have to hand down more than outrage. They have to hand down continuity. That means naming what is shared, explaining why it matters, and modeling forms of patience that make repair visible instead of abstract. Memory grows stronger when people rehearse gratitude, responsibility, and neighborly duty in public language. A culture recovers when its people can once again connect sacrifice, belonging, and purpose without embarrassment." } },
    { message: { content: "First we establish shared memory, then reveal its fracture, then expand its public consequences and repair practices together." } },
    { message: { content: "Stay through this and you will see how broken memory weakens public trust, hardens language, and can still be repaired together." } },
    { message: { content: "What happens when shared memory collapses?" } },
    { message: { content: "Remember the arc. When shared memory thins, language hardens, institutions hollow out, and neighbors lose the thread of common purpose. But when people recover truthful speech, repeated duty, and patient responsibility, public life becomes more human, more trustworthy, and more repairable under real strain." } },
    { message: { content: "Start where you live: restore shared memory with truthful speech, repeated duties, and patient repair, then teach those habits to others." } }
  ]);

  try {
    const { logs, errors } = await runScript("command/run_pya_program.mjs", [
      "examples/pyash/refinery-module-manuscript-run.pya",
      source,
      "shared memory"
    ]);

    assertNoUnexpectedErrors(errors);
    const output = logs.join("\n").trim();
    const sections = output.split(/\n\s*\n/u).map(part => part.trim()).filter(Boolean);
    assert.equal(sections.length, 8);

    assert.ok(countWords(sections[0]) >= 6 && countWords(sections[0]) <= 8);
    assert.ok(countWords(sections[1]) >= 18 && countWords(sections[1]) <= 24);
    assert.ok(countWords(sections[2]) >= 16 && countWords(sections[2]) <= 20);
    assert.ok(countWords(sections[3]) >= 85 && countWords(sections[3]) <= 100);
    assert.ok(countWords(sections[4]) >= 95 && countWords(sections[4]) <= 115);
    assert.ok(countWords(sections[5]) >= 95 && countWords(sections[5]) <= 115);
    assert.ok(countWords(sections[6]) >= 40 && countWords(sections[6]) <= 50);
    assert.ok(countWords(sections[7]) >= 20 && countWords(sections[7]) <= 25);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
