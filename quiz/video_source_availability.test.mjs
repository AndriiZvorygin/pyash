import assert from "node:assert/strict";
import test from "node:test";

import {
  isiMeetingVideoIsReachable,
  isReachableIsiPlayerSource,
} from "../program/library/reporter_shared/video-source-availability.mjs";

test("an eScribe ISI player is unavailable when its embedded recording is 404", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push([String(url), options.method || "GET"]);
    if (String(url).includes("ISIStandAlonePlayer.aspx")) {
      return new Response('<div id="isi_player" data-client_id="county" data-file_name="Meeting File.mp4"></div>', { status: 200 });
    }
    return new Response("", { status: 404 });
  };
  assert.equal(await isReachableIsiPlayerSource("https://example.escribemeetings.com/Players/ISIStandAlonePlayer.aspx?Id=abc", { fetchImpl }), false);
  assert.deepEqual(calls, [
    ["https://example.escribemeetings.com/Players/ISIStandAlonePlayer.aspx?Id=abc", "GET"],
    ["https://video.isilive.ca/county/Meeting%20File.mp4", "HEAD"],
  ]);
});

test("an eScribe ISI player is available when its embedded recording responds", async () => {
  const fetchImpl = async (url) => String(url).includes("ISIStandAlonePlayer.aspx")
    ? new Response('<div data-client_id="county" data-file_name="Meeting.mp4"></div>', { status: 200 })
    : new Response("", { status: 200 });
  assert.equal(await isReachableIsiPlayerSource("https://example.escribemeetings.com/Players/ISIStandAlonePlayer.aspx?Id=abc", { fetchImpl }), true);
});

test("an official fallback video keeps a meeting eligible when its ISI player expired", async () => {
  const payload = {
    video: [
      "https://pub-grey.escribemeetings.com/Players/ISIStandAlonePlayer.aspx?Id=abc",
      "https://www.youtube.com/watch?v=recording",
    ],
  };
  assert.equal(await isiMeetingVideoIsReachable(payload, {
    fetchImpl: async () => new Response("", { status: 404 }),
  }), true);
});
