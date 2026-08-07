import assert from "node:assert/strict";
import test from "node:test";

import {
  dateIsoFromYoutubeTitle,
  discoverGreyCountyYoutubeStreams,
  selectLongestOfficialYoutubeRecording,
  youtubeStreamMatchesMeeting,
} from "../world/house/grey-county-reporter/program/grey-county-youtube-recordings.mjs";

test("Grey County stream titles map to the meeting date and combined bodies", () => {
  const stream = {
    title: "Council and Committee of the Whole July 23 2026",
    date_iso: "2026-07-23",
  };
  assert.equal(dateIsoFromYoutubeTitle(stream.title), "2026-07-23");
  assert.equal(youtubeStreamMatchesMeeting(stream, {
    meeting_name: "County Council",
    start_local: "2026-07-23T10:00:00",
  }), true);
  assert.equal(youtubeStreamMatchesMeeting(stream, {
    meeting_name: "Committee of the Whole",
    start_local: "2026-07-23T10:15:00",
  }), true);
  assert.equal(youtubeStreamMatchesMeeting(stream, {
    meeting_name: "County Council",
    start_local: "2026-07-09T10:00:00",
  }), false);
});

test("stream discovery reads the official Live playlist", () => {
  const rows = discoverGreyCountyYoutubeStreams({
    execFileSyncImpl: (_command, args) => {
      assert.ok(String(args.at(-1)).endsWith("/streams"));
      return JSON.stringify({
        entries: [{
          id: "video1",
          title: "Council and Committee of the Whole July 23 2026",
          url: "https://www.youtube.com/watch?v=video1",
        }],
      });
    },
  });
  assert.deepEqual(rows, [{
    id: "video1",
    title: "Council and Committee of the Whole July 23 2026",
    url: "https://www.youtube.com/watch?v=video1",
    date_iso: "2026-07-23",
  }]);
});

test("duplicate or reconnected streams select the longest official recording", () => {
  const durations = new Map([["short", 109], ["long", 8178]]);
  const selected = selectLongestOfficialYoutubeRecording([
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=long",
  ], {
    execFileSyncImpl: (_command, args) => {
      assert.ok(args.includes("youtube:player_client=android_vr"));
      const id = String(args.at(-1)).split("=").at(-1);
      return JSON.stringify({
        id,
        webpage_url: args.at(-1),
        channel_id: "UCw_WmatPnvP6MqyUBlCAYpw",
        duration: durations.get(id),
      });
    },
  });
  assert.equal(selected.id, "long");
  assert.equal(selected.duration, 8178);
});
