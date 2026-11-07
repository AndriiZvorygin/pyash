# Pyash ZIM workflow

## Plan

1. Reuse Pyash's typed `fromstate` and `tostate` selectors for text, an HTML
   folder, an existing WARC, and a web URL. The target state is ZIM.
2. Route local text and HTML content through the configured libzim writer. Route
   web capture through Zimit, keeping its WARC output beside the ZIM; convert a
   supplied WARC through the same Zimit tool image's `warc2zim` command.
3. Keep archive creation, reading, and searching on the existing Pyash verbs:
   `cluster-compress`, `write as cluster-compress`, `read as cluster-compress`,
   and `search as cluster-compress`.
4. Run external tools through the existing `command` verb and policy. Validate
   all input, output, and HTML-folder paths against the active command working
   and access roots; refuse overwrite and HTML symlinks.
5. Add focused quizzes for each source state, read/search, policy routing, and
   path guards, then document the required host tools and container image.

## Supported conversions

The source state describes the input artifact. The destination state describes
the goal artifact; temporary HTML and WARC files remain implementation
artifacts within the same conversion. The output's parent directory must
already exist and be writable under the active command sandbox.

Text becomes one HTML article with escaped text content, then a ZIM archive:

```pyash
from filename "notes.txt" fromstate wo text tostate wo zim to filename "archives/notes.zim" be cluster-compress do
```

An existing self-contained HTML directory becomes a ZIM archive. It must
contain the configured welcome page (default `index.html`) and cannot contain
symbolic links:

```pyash
from filename "site" fromstate wo html tostate wo zim to filename "archives/site.zim" be cluster-compress do
```

A web URL is captured by Zimit. Its WARC and other retained capture data are
stored in `archives/site.zim.capture/` alongside `archives/site.zim`:

```pyash
from filename "https://example.org/" fromstate wo web tostate wo zim to filename "archives/site.zim" be cluster-compress do
```

An existing WARC can be converted without recapturing the site:

```pyash
from filename "capture/site.warc" fromstate wo warc tostate wo zim to filename "archives/site.zim" be cluster-compress do
```

The normal write form also accepts a text value or filename and selects the
local input kind from its value or filesystem type:

```pyash
ob filename "notes.txt" to filename "archives/notes.zim" as wo cluster-compress be write do
```

## Read and search

`read` lists the archive entries when `ob text` is omitted. With an entry URL it
returns that article's content:

```pyash
from filename "archives/site.zim" as wo cluster-compress be read do
from filename "archives/site.zim" as wo cluster-compress ob text "index.html" be read do
```

Search uses Kiwix's `kiwix-search` command and the full-text index embedded in
the ZIM. The `zimwriterfs` default builds that index. `read` uses OpenZIM's
`zimdump` to list entries or extract one article directly. For browser-based
retrieval and interactive search, the optional Kiwix Server serves the same
ZIM and its embedded index:

```pyash
ob text "offline archive" in filename "archives/site.zim" as wo cluster-compress be search do
```

When the search `filename` names a directory, Pyash searches each top-level
regular `*.zim` file in name order and prefixes each match with its archive
filename. It does not descend into subdirectories or follow symlinks. This
supports direct agent retrieval from the shared library:

```pyash
ob text "offline archive" in filename "world/library/archive" as wo cluster-compress be search do
from filename "world/library/archive/site.zim" as wo cluster-compress ob text "index.html" be read do
```

## Tools and configuration

Local text and HTML conversion invokes `zimwriterfs` through Pyash `command`.
Reading uses `zimdump`; searching uses Kiwix's `kiwix-search`. Web capture uses
Docker with the configured Zimit image, defaulting to `ghcr.io/openzim/zimit`;
the container must be available locally or Docker must be able to retrieve it.
The existing command policy classifies archive creation tools as local writers,
archive inspection/search tools as read-only, and Docker under process control.
Command policy, timeout, network, and sandbox settings remain authoritative.

Set `PYA_ENABLE_ZIM_TOOLS=truth` and run `npm run setup:zim` to install the
Debian/Ubuntu host packages and build `pyash/zim-tools:ubuntu-24.04` from
`containers/zim-tools/Dockerfile`. With the CI variable
`PYA_ENABLE_ZIM_TOOLS=true`, CI builds the image and runs an actual
create/read/search smoke test. The integration quiz skips by default, keeping
normal setup and CI lightweight.

Defaults live in `configure/default.pya`: writer, reader, search tool, Zimit
image, archive metadata defaults, and the existing `ksus hzip` compound. The
resulting `.zim` remains a file artifact. `containers/kiwix-server/` provides a
read-only server for the shared `world/library/archive/` collection on host port
8091 over IPv4 and IPv6. Every top-level `*.zim` file in that directory is
included when the container starts. Add or remove files there and restart the
service to refresh the collection. Pyash agents can search the collection
directory with the existing `search as cluster-compress` verb and retrieve a
selected entry with `read as cluster-compress`. The server HTTP search endpoint
searches across the loaded archives.
