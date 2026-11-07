# Kiwix Server

This container serves the shared Pyash ZIM collection from
`world/library/archive/`. Every top-level `*.zim` file in that directory is loaded
when the server starts. The directory is mounted read-only. The server listens
on host port `8091` over IPv4 and IPv6; port `8080` remains available to other
local services. Put at least one archive in the collection before starting it.

```sh
docker compose -f containers/kiwix-server/compose.yaml up -d
```

Open <http://127.0.0.1:8091/> or <http://[::1]:8091/> to browse the library.
Adding or removing a ZIM means adding or removing a top-level file in
`world/library/archive/`, then restarting the service so Kiwix reloads the
collection:

```sh
docker compose -f containers/kiwix-server/compose.yaml restart
```

The Kiwix search endpoint is available at
`http://[::1]:8091/search?pattern=QUERY&format=xml`. Its `pattern` parameter
searches the loaded collection. Agents can also use Pyash's existing per-archive
`search as cluster-compress` and `read as cluster-compress` verbs directly on
files in `world/library/archive/`.

## Creating and searching archives from Pyash

See [the Pyash ZIM workflow](../../documentation/reference/pyash-zim-workflow.md)
for source-state conversions, article reads, and searches. For example, a
website capture uses Zimit and retains the WARC under the capture directory:

```pyash
from filename "https://example.org/" fromstate wo web tostate wo zim to filename "archives/site.zim" be cluster-compress do
```

Local text and HTML-folder conversions use `zimwriterfs`; archive reads use
`zimdump`; searches use `kiwix-search`. These tools run through Pyash's existing
command policy and sandbox. The container in this directory only serves
completed ZIM files; it does not create them.

The curated Pyash compound `ksus hzip` names cluster compression. Defaults for
the writer, Zimit image, metadata, and retrieval tool are in
`configure/default.pya`.

References: [Kiwix Server Docker guide](https://github.com/kiwix/kiwix-tools/blob/main/docker/server/README.md),
[Zimit](https://github.com/openzim/zimit), and
[libzim writer configuration](https://github.com/openzim/libzim/blob/main/include/zim/writer/creator.h).
