import test from "node:test";
import assert from "node:assert/strict";

import { parseSseStream } from "../program/motor/mcp.mjs";

test("mcp sse parser preserves data whitespace", async () => {
  const encoder = new TextEncoder();
  const payload = [
    "event: response",
    "id:  42",
    "data:  {\"id\":1,\"result\":\"  hi  \"}",
    "",
    ""
  ].join("\n");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  });

  const events = [];
  for await (const event of parseSseStream(stream)) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    event: "response",
    id: " 42",
    data: " {\"id\":1,\"result\":\"  hi  \"}"
  });
});
