import test from "node:test";
import assert from "node:assert/strict";

test.todo("map at all can conditionally invert based on at index and pass (needs genitive remains)");

  const lines = [
    "exists subj name doors obj ve bool truth lie truth lie be vector ya",
    "subj name toggle if be ceremony def",
    "obj num ti atindex ti this be remains from num ti by ti this to name mod do",
    "obj name mod be equally from num 0 then obj name doors at num ti atindex ti this be invert do",
    "subj name toggle if be ceremony prah",
    "obj name doors at name all by num 2 be toggle if do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const doors = remember("doors")?.obj?.ve?.values;
  assert.ok(Array.isArray(doors));
  assert.deepEqual(doors, ["truth", "truth", "truth", "truth"]);
});
