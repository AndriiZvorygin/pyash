import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { resolveWorktreePath } from "../../program/runtime/work/workspace.mjs";

test("default task worktrees are stored beside the repository, outside holding", () => {
  const worktreePath = resolveWorktreePath({
    repositoryRoot: "/srv/project/pyash",
    worldRoot: "/srv/project/pyash/world",
    taskId: "roadmap-task",
    env: {}
  });

  assert.equal(worktreePath, "/srv/project/pyash-worktrees/roadmap-task");
  assert.equal(worktreePath.includes(`${path.sep}holding${path.sep}`), false);
});

test("configured worktree root is used for new task checkouts", () => {
  const worktreePath = resolveWorktreePath({
    repositoryRoot: "/home/htaf/pyash",
    worldRoot: "/home/htaf/pyash/world",
    taskId: "roadmap-task",
    env: { PYA_WORKTREE_ROOT: "/srv/data/pyash-worktrees" }
  });

  assert.equal(worktreePath, "/srv/data/pyash-worktrees/roadmap-task");
});

test("a configured worktree root inside holding is rejected", () => {
  assert.throws(() => resolveWorktreePath({
    repositoryRoot: "/home/htaf/pyash",
    worldRoot: "/home/htaf/pyash/world",
    taskId: "roadmap-task",
    env: { PYA_WORKTREE_ROOT: "/home/htaf/pyash/world/holding/work/worktrees" }
  }), /worktree root must be outside world\/holding/u);
});

test("explicit checkpoint worktree paths remain authoritative", () => {
  const worktreePath = resolveWorktreePath({
    repositoryRoot: "/home/htaf/pyash",
    taskId: "roadmap-task",
    worktreePath: "/srv/data/pyash-worktrees/recorded-task",
    env: { PYA_WORKTREE_ROOT: "/tmp/other" }
  });

  assert.equal(worktreePath, "/srv/data/pyash-worktrees/recorded-task");
});
