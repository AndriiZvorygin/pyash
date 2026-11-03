import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { requestStream } from "../program/motor/openai_mind.mjs";

test("OpenAI-compatible stream preserves text and assembles fragmented tool calls", async () => {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"Checking "}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"be_command","arguments":"{\\"cmd\\":"}}]}}]}\n\n');
    response.end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"pwd\\"}"}}]}}],"usage":{"prompt_tokens":21,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const chunks = [];
  try {
    const result = await requestStream({
      host: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      body: { model: "test", messages: [{ role: "user", content: "inspect" }] },
      onChunk: (chunk) => chunks.push(chunk)
    });
    assert.deepEqual(chunks, ["Checking "]);
    assert.equal(result.message.content, "Checking ");
    assert.equal(result.message.tool_calls[0].id, "call_1");
    assert.equal(result.message.tool_calls[0].function.name, "be_command");
    assert.equal(result.message.tool_calls[0].function.arguments, '{"cmd":"pwd"}');
    assert.equal(result.usage.prompt_tokens, 21);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
