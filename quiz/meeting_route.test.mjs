import test from "node:test";
import assert from "node:assert/strict";

import { canonicalMeetingRouteSlug } from "../program/library/reporter_shared/meeting-route.mjs";

test("canonical meeting routes collapse duplicated feed type prefixes", () => {
  assert.equal(
    canonicalMeetingRouteSlug("Committee - Committee of Adjustment"),
    "committee-of-adjustment",
  );
  assert.equal(canonicalMeetingRouteSlug("Committee - Corporate Services"), "committee-corporate-services");
  assert.equal(canonicalMeetingRouteSlug("Council Meeting"), "council-meeting");
});
