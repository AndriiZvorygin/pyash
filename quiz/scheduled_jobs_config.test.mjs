import test from "node:test";
import assert from "node:assert/strict";

import { resolveMatrixConfigWithRemember } from "../program/agent/scheduled_jobs.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";

test("scheduled jobs keep per-agent matrix user over global map user", () => {
  forget();
  try {
    doRemember({
      mood: "ya",
      su: { name: "matrix channel" },
      be: "map",
      ob: {
        map: {
          user: { ob: { text: "@global:matrix.liberit.ca" } },
          homeserver: { ob: { text: "https://matrix.liberit.ca" } },
          token: { ob: { text: "global-token" } }
        }
      }
    });

    const resolved = resolveMatrixConfigWithRemember({
      user: "@pyash-agent:matrix.liberit.ca",
      homeserver: "https://matrix.liberit.ca",
      token: "agent-token"
    });

    assert.equal(resolved.user, "@pyash-agent:matrix.liberit.ca");
    assert.equal(resolved.token, "agent-token");
  } finally {
    forget();
  }
});

test("scheduled jobs still use global matrix user when agent policy has none", () => {
  forget();
  try {
    doRemember({
      mood: "ya",
      su: { name: "matrix channel" },
      be: "map",
      ob: {
        map: {
          user: { ob: { text: "@global:matrix.liberit.ca" } },
          homeserver: { ob: { text: "https://matrix.liberit.ca" } },
          token: { ob: { text: "global-token" } }
        }
      }
    });

    const resolved = resolveMatrixConfigWithRemember({
      homeserver: "https://matrix.liberit.ca"
    });

    assert.equal(resolved.user, "@global:matrix.liberit.ca");
    assert.equal(resolved.token, "global-token");
  } finally {
    forget();
  }
});
