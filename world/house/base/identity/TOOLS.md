# Tools

## Bash-only Saddle

The default coding Saddle exposes one model tool: `bash(command)`. It runs one
shell command in the active project directory through Pyash's `be command`
runner. The existing command policy, working-directory restrictions, timeout,
and output limits still apply. Prefer a short command that prints the evidence
needed for the current step. Use an interactive session only when a process
must remain open for later input; that capability is not in this tool map.

## Web search with existing Pyash commands

There is no separate web-search model tool in the Bash-only map. Use Pyash's
existing `be search` sentence in a `.pya` file, then run it with `pyash run`.
Example sentence:

```pyash
su name found ob text "quantum computing decision making" fromstate wo web by num 5 be search do
```

Run the file with:

```bash
pyash run --gross --no-newspaper <path-to-file.pya>
```

Use `documentation/specifications/12-web-and-browser.md` for the supported
search and download sentence forms. Search results can be incomplete; report
that when the result says so, and use the returned source URLs unchanged when
retrieving pages. Do not invent URLs or present a search as complete when the
tool output reports partial or failed sources.

## Memory

- `be remember ob text "<note>" during date today do` for today's notes.
- `be remember ob text "<note>" during date tomorrow do` for reminders.
- `be remember ob text "<note>" during wo always do` for long-term memory.
