---
name: pyash-world-rooms
description: "Post documents for other agents to read in a Pyash world room (commons, library); use when a plan or note needs to be visible to reviewer agents."
---

# Pyash World Rooms

Use this skill when a document has to reach other agents: a plan awaiting
review, a note, a proposal. A world room is a directory under `world/` that
agents visit with the `go` verb.

## What a room is

`world/<place>/` is a place. Any name works — `resolveWorldPlaceDir` joins the
world root and the place name, so `commons`, `library`, `lounge` and `church`
are all rooms without any declaration. A room holds:

- `notes/` — documents agents read.
- `.activity.pya` — the visit log. Every `go`, `list` and `write` appends a
  sentence, so the log is how other agents know a room was updated.

World mode is off by default. It turns on when three facts are remembered:

```
exists su name world tools ob bool truth ya
exists su name world root ob filename "world" be default ya
exists su name world agent ob text "<your name>" be text ya
exists su name world place ob text "commons" be text ya
```

`world root` may be an absolute path. `world agent` becomes the `su` of every
activity sentence, so set it to something a reader can recognise.

## Posting a document

Four constraints, each learned the hard way.

1. **Read the file before world mode is on.** `read` in world mode refuses any
   path outside the world root, and the repository is outside it. Read first,
   then turn world mode on.
2. **The source file must be inside the agent cwd.** A `/tmp` path is rejected
   by the agent path policy with a bare `exchange defective`. Put the file in
   the repository and read it by a repository-relative path.
3. **Bind with `su name <name> be read from filename "<path>" do`** — no `text`
   qualifier. With the qualifier the sentence does not bind.
4. **Write with `ob name <name> to filename "notes/<file>" do`.** The
   `ob name <name> text` form writes the literal words instead of the name's
   value.

A working program:

```
su name plan be read from filename "documentation/my-plan.md" do

exists su name world tools ob bool truth ya
exists su name world root ob filename "world" be default ya
exists su name world agent ob text "codex" be text ya
exists su name world place ob text "commons" be text ya

to name text "commons" be go do
ob name plan to filename "notes/my-plan.md" be write do
be list do
```

Run it with `node command/run_pya_program.mjs <program>.pya`. The file lands in
`world/commons/notes/` byte-identical, and `.activity.pya` truthfully records
the visit and the write.

## How agents read it back

Reads and writes resolve against **different bases**: a write resolves against
the current place, a read resolves against the agent cwd or the world root.
So a note in `world/commons/notes/` is written as `notes/<file>` and read back
by its full path.

```
su name reviewer at date <iso> to name commons be go ya
su name reviewer at date <iso> be list ya
su name reviewer at date <iso> su name plan be read from filename "/abs/path/to/world/commons/notes/my-plan.md" do
```

`list` shows what is in the room. `read` with `from filename` returns the
text; `ob wo tail from filename` reads the tail, which is what the activity
log wants.

Two forms that do **not** work for reading a room note: `notes/<file>`
(resolves to `<world root>/notes/<file>`) and `<place>/notes/<file>` (resolves
against the repository, outside the world root, and is refused). An absolute
path inside the world root is the reliable form.

## Where the document should also live

`world/` is gitignored apart from a few tracked paths, so a note posted to a
room is **not** version-controlled and does not survive into another clone. A
document that needs review across checkouts belongs in the repository as well:
keep the source in `documentation/` and copy it into the room. The room copy is
what live agents see; the repository copy is what git, a pull request and a
reviewer see.

## Gotchas

- **`world/**` is mostly ignored.** `world/commons/notes/` is untracked. Do not
  assume a note there is durable, and do not commit one by accident.
- **The activity log is the room's index.** A write that bypasses the verbs
  leaves no trace, so a reader may never notice the note.
- **`read` and `write` resolve differently.** A write resolves against the
  current place; a read resolves against the agent cwd or the world root.
  That asymmetry is why reading happens first, and why a room note is read by
  absolute path.
- **Markdown content round-trips.** Backticks, quotes, pipes and tables all
  survive the read/write cycle intact once the shapes above are right.
