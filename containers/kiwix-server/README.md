# Kiwix Server

This optional container serves ZIM files from an existing host directory. It
binds to loopback on port 8080, and mounts the library read-only.

```sh
ZIM_LIBRARY_PATH=/path/to/zim-files docker compose up -d
```

Open <http://127.0.0.1:8080/> to browse the library. Keep archive files in the
chosen host directory and point `ZIM_LIBRARY_PATH` there.

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
