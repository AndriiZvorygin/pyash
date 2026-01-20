import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember, remember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder, emitExchangeSentence } from "../program/bridge/exchange.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";

function addDaysIsoDate(iso, days) {
  const base = new Date(iso);
  const millis = base.getTime() + days * 24 * 60 * 60 * 1000;
  const next = new Date(millis);
  return next.toISOString().slice(0, 10);
}

test("mcp time plan uses current date and computes 30 days out", async () => {
  forget();
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });
  const serverPath = path.resolve("quiz/fixtures/mcp_time_mock_server.json");
  doRemember({
    mood: "ya",
    su: { name: "time" },
    be: "mcp",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });

  await interpret(parse("from name mcp time to name mcp clock be import do"));

  const callSentence = parse("ob text \"America/Toronto\" be mcp clock get_current_time do");
  await interpret(callSentence);

  const result = remember("result");
  const mapName = result?.ob?.name;
  const mapSentence = mapName ? remember(mapName) : null;
  const datetime = mapSentence?.ob?.map?.datetime?.text;
  assert.equal(datetime, "2026-01-20T12:00:00-05:00");

  const targetDate = addDaysIsoDate(datetime, 30);
  const toolEvent = {
    mood: "ya",
    su: { name: "tool event 000001" },
    be: "tool",
    ob: { la: callSentence },
    to: { la: result }
  };
  emitExchangeSentence(toolEvent);
  emitExchangeSentence({
    mood: "ya",
    su: { name: "time plan result" },
    be: "text",
    ob: { text: targetDate }
  });

  assert.ok(records.some(entry => entry?.be === "tool"));
  assert.ok(records.some(entry => entry?.ob?.text === targetDate));

  closeMcpServers();
  clearExchangeRecorder();
});
