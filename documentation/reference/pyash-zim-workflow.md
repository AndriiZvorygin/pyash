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

Web capture is network-enabled for this specific operation by the
`web archive network` default. General command sandbox network
settings remain unchanged. The `web archive configure` map in
`configure/default.pya` sets prefix scope, one worker, a one-second interval
between pages, a 2,000-page cap, a 90-second page-load timeout, a one-hour
hard time limit, and a 2 GiB hard WARC-size limit. Its default block rule
omits common image formats to keep captures text-focused. The default
`web archive behavior` value leaves out Browsertrix's `autofetch` behavior,
which fetches alternate image resolutions and lazy-loaded resources. Keep
that behavior disabled for a no-image capture; enable it together with an
adjusted photograph filter when images are wanted. A `custom` scope requires
one or more URL regexes in the `web archive page include` series; they are
passed to Zimit as `--scopeIncludeRx` rules. The page delay is a coarse pacing
control; it does not cap individual HTTP requests per second. Local Pyash
configuration can override these settings.

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

For a large page, focus the read on the phrase from the search query. Pyash
fetches that entry from the configured Kiwix server and returns a bounded set
of passages with their nearest headings:

```pyash
from filename "world/library/archive/gpu-opencl-reference-2026-11.zim" as wo cluster-compress ob text "OpenCL_API.html" by text "clCreateBuffer" be read do
```

The shared-library focused read defaults to an 8 MiB page-fetch limit, a 900
character context around each match, and a 16,000 byte output limit. The page
and output limits are set by `archive focus page size bytes` and
`archive focus result size bytes` in `configure/default.pya`.

Search with only a query and `fromstate wo zim` uses the configured
`world/library/archive` collection by default and queries the configured Kiwix
Server's full-text index. When the archive collection is mounted locally,
results include its archive path, article title, entry path, and matching
excerpt. A remote Kiwix server can also provide query-only search without a
local archive mount; those results identify the archive from the server's
archive ID or book title. This is useful when the indexed ZIM collection is
hosted elsewhere. Each result includes a `page` URL for the Kiwix content route.
Download it directly as Markdown and read the saved file to inspect the full
page; raw HTML is available when the markup itself matters:

```pyash
be download from filename "https://zim.example/content/rust/book.html" as wo markdown to filename "artifacts/rust-book.md" do
from filename "artifacts/rust-book.md" be read do
```

If neither the local collection nor a configured search server is available,
search fails with a clear configuration error. The `zimwriterfs` default builds
the index.
`read` uses OpenZIM's `zimdump` to list entries or extract one article directly.
The server also supports searching one archive from that shared collection;
an explicit archive path overrides the default collection:

```pyash
ob text "Pyash" fromstate wo zim be search do
ob text "Pyash" in filename "world/library/archive/pyash-hierarchy.zim" as wo cluster-compress be search do
```

When `filename` names the shared library directory or one of its direct
archives, Pyash queries the server for full results. Other archive directories
use the local `kiwix-search` command and return its matching titles; directory
search only considers top-level regular `*.zim` files in name order and does
not follow subdirectories or symlinks. This supports direct agent retrieval
from the shared library:

```pyash
ob text "Pyash" in filename "world/library/archive" as wo cluster-compress be search do
from filename "world/library/archive/pyash-hierarchy.zim" as wo cluster-compress ob text "index.html" be read do
```

## Tools and configuration

Local text and HTML conversion invokes `zimwriterfs` through Pyash `command`.
Reading uses `zimdump`; shared-library search uses the configured Kiwix Server,
and other local searches use `kiwix-search`. Web capture uses
Docker with the configured Zimit image, defaulting to `ghcr.io/openzim/zimit`;
the container must be available locally or Docker must be able to retrieve it.
The existing command policy classifies archive creation tools as local writers,
archive inspection/search tools as read-only, and Docker under process control.
Command policy, timeout, and sandbox settings remain authoritative for the
underlying process; the URL-capture permission and bounded crawler profile are
specific to Zimit.

Set `PYA_ENABLE_ZIM_TOOLS=truth` and run `npm run setup:zim` to install the
Debian/Ubuntu host packages and build `pyash/zim-tools:ubuntu-24.04` from
`containers/zim-tools/Dockerfile`. With the CI variable
`PYA_ENABLE_ZIM_TOOLS=true`, CI builds the image and runs an actual
create/read/search smoke test. The integration quiz skips by default, keeping
normal setup and CI lightweight.

Defaults live in `configure/default.pya`: writer, reader, search tool, Zimit
image, crawl permission and bounds, archive metadata defaults, the shared ZIM
library and Kiwix endpoint, and the `ksus mres` cluster-compression compound.
The compound uses existing atoms for “cluster” and information “compression”;
its project gloss describes ZIM cluster compression because WordNet has no
single synset for that specific operation. Host-local library or server
overrides belong in `configure/secret.pya`. The
resulting `.zim` remains a file artifact. `containers/kiwix-server/` provides a
read-only server for the shared `world/library/archive/` collection on host port
8091 over IPv4 and IPv6. The persistent host collection lives at
`/srv/search/archive/`; `world/library/archive/` is its stable Pyash-facing
symlink. Every top-level `*.zim` file in the persistent directory is included
when the container starts. Add or remove files through either path and restart
the service to refresh the collection. Pyash agents can search the collection
directory with the existing `search as cluster-compress` verb and retrieve a
selected entry with `read as cluster-compress`. The server HTTP search endpoint
searches across the loaded archives. The public browser and search endpoint is
`https://zim.zvorygin.ca`, reverse-proxied by Caddy to the local Kiwix server;
the DNS updater includes this hostname in its dual-stack web records.
The host library's `pyash-documentation.zim` snapshot was built from 152
Markdown, text, and JSON documents beneath `documentation/`. The current
language, assembly, and GPU coding collections are listed in
[offline-code-references.md](offline-code-references.md). The domain root
provides full-text article search, including queries encoded in the URL
fragment; `/library` opens Kiwix's archive catalog. The searchable page is
`containers/kiwix-server/search-ui/index.html`.
