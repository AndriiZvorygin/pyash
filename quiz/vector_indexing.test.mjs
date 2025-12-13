import test from "node:test";
import assert from "node:assert/strict";

// TODO: implement vector element addressing (read/write/invert) with "at" + quantity index.

test("read element from numeric vector via at num <index>", { todo: true }, async () => {
  /*
    Goal shape:
      exists subj name doors obj ve num 0 1 0 be vector ya
      obj name doors at num 2 be read to name picked do
    Expect: remember("picked").obj.num === 1
  */
  assert.fail("pending implementation of vector element read");
});

test("invert boolean element via at num <index>", { todo: true }, async () => {
  /*
    Goal shape:
      exists subj name doors obj ve text truth lie truth be vector ya
      invert obj name doors at num 2 do
    Expect doors.obj.ve.values[1] toggles (truth↔lie), result also reflected in remember("result")
    (boolean type preferred; numbers 0/1 acceptable fallback)
  */
  assert.fail("pending implementation of vector element invert");
});
