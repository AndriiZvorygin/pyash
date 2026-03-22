import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("nickname aliases a plain binding for imperative writes", async () => {
  forget();

  await run("exists su name bucket ob num 1 be number ya");
  await run("exists su name bucket alias ob name bucket be nickname ya");
  await run("ob num 2 to name bucket alias be plus do");

  assert.equal(remember("bucket")?.ob?.num, 3);
  assert.equal(remember("bucket alias")?.ob?.num, 3);
});

test("nickname aliases a genitive map slot for imperative writes", async () => {
  forget();

  await run("su name profile be json map def");
  await run("su name score ob num 1 ya");
  await run("prah");
  await run("exists su name score alias ob score of profile be nickname ya");
  await run("ob num 2 to name score alias be plus do");

  assert.equal(remember("profile")?.ob?.map?.score?.num, 3);
  assert.equal(remember("score alias")?.ob?.num, 3);
});

test("nickname sees later updates from the original slot", async () => {
  forget();

  await run("su name profile be json map def");
  await run("su name score ob num 1 ya");
  await run("prah");
  await run("exists su name score alias ob score of profile be nickname ya");
  await run("ob num 4 to score of profile be plus do");

  assert.equal(remember("score alias")?.ob?.num, 5);
});

test("nickname can write text through a genitive slot", async () => {
  forget();

  await run("su name profile be json map def");
  await run('su name review ob text "old" ya');
  await run("prah");
  await run("exists su name review alias ob review of profile be nickname ya");
  await run('ob text "new" to name review alias be text do');

  assert.equal(remember("profile")?.ob?.map?.review?.text, "new");
  assert.equal(remember("review alias")?.ob?.text, "new");
});

test("nickname direct ya writes update the aliased slot instead of replacing the alias", async () => {
  forget();

  await run("su name profile be json map def");
  await run("su name score ob num 1 ya");
  await run("prah");
  await run("exists su name score alias ob score of profile be nickname ya");
  await run("su name score alias ob num 9 be number ya");

  assert.equal(remember("profile")?.ob?.map?.score?.num, 9);
  assert.equal(remember("score alias")?.ob?.num, 9);
  assert.equal(remember("score alias")?.be, "number");
});

test("nickname can alias a genitive path off this inside a ceremony", async () => {
  forget();

  await run("su name bump score ob name map profile be ceremony def");
  await run("exists su name local score ob score of ob of this be nickname ya");
  await run("ob num 2 to name local score be plus do");
  await run("prah");
  await run("su name profile be map def");
  await run("su name score ob num 1 ya");
  await run("prah");
  await run("ob name profile be bump score do");

  assert.equal(remember("profile")?.ob?.map?.score?.ob?.num, 3);
});
