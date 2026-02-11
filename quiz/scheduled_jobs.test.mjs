import test from "node:test";
import assert from "node:assert/strict";

import { mergeMatrixDmRooms } from "../program/agent/scheduled_jobs.mjs";

test("mergeMatrixDmRooms adds unique dm rooms and preserves existing room entries", () => {
  const merged = mergeMatrixDmRooms({
    channelConfig: {
      rooms: [
        { id: "!main:server", lane: "matrix_main" },
        { id: "!dm-existing:server", lane: "matrix_dm_existing_server" }
      ],
      dmRooms: ["!dm-existing:server"]
    },
    dmRoomIds: ["!dm-existing:server", "!dm-new:server"],
    channelType: "matrix"
  });

  assert.deepEqual(merged.dmRooms, ["!dm-existing:server", "!dm-new:server"]);
  assert.equal(merged.rooms.length, 3);
  assert.deepEqual(merged.rooms[1], { id: "!dm-existing:server", lane: "matrix_dm_existing_server" });
  assert.deepEqual(merged.rooms[2], { id: "!dm-new:server", lane: "matrix_dm_new_server" });
});
