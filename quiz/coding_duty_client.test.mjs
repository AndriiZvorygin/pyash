import assert from "node:assert/strict";
import test from "node:test";

import { requestCodingDutyHub, resolveCodingDutyHub } from "../program/agent/coding_duty_client.mjs";

test("duty resume hub requires authenticated HTTPS away from loopback", () => {
  assert.deepEqual(resolveCodingDutyHub({
    PYA_DUTY_HUB_URL: "https://pyash.example/",
    PYA_DUTY_HUB_AUTHORIZATION: "Basic private-value"
  }), {
    baseUrl: "https://pyash.example",
    authorization: "Basic private-value"
  });
  assert.throws(() => resolveCodingDutyHub({
    PYA_DUTY_HUB_URL: "http://remote.example",
    PYA_DUTY_HUB_AUTHORIZATION: "Basic private-value"
  }), /HTTPS/u);
  assert.throws(() => resolveCodingDutyHub({ PYA_DUTY_HUB_URL: "https://pyash.example" }), /AUTHORIZATION/u);
});

test("duty hub client sends authorization and parses structured responses", async () => {
  let request;
  const result = await requestCodingDutyHub({
    baseUrl: "https://pyash.example",
    authorization: "Basic private-value"
  }, "/api/duties/duty-test", {
    method: "POST",
    body: { message: "continue" },
    fetchFn: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ ok: true, duty: { id: "duty-test" } }), { status: 200 });
    }
  });
  assert.equal(request.url, "https://pyash.example/api/duties/duty-test");
  assert.equal(request.options.headers.authorization, "Basic private-value");
  assert.deepEqual(JSON.parse(request.options.body), { message: "continue" });
  assert.equal(result.duty.id, "duty-test");
});

test("duty hub client reports service errors without hiding their reason", async () => {
  await assert.rejects(() => requestCodingDutyHub({
    baseUrl: "https://pyash.example",
    authorization: "Basic private-value"
  }, "/api/duties/missing", {
    fetchFn: async () => new Response(JSON.stringify({
      ok: false,
      error: { message: "duty not found" }
    }), { status: 404 })
  }), /duty not found/u);
});
