# Pyash ZIM tools image

This image contains Ubuntu's `zim-tools` and `kiwix-tools` packages:

- `zimwriterfs` creates ZIM archives from local HTML.
- `zimdump` lists and extracts archive articles.
- `kiwix-search` searches a ZIM's embedded full-text index.
- `kiwix-serve` provides browser and HTTP access to ZIM files.

Build it and install the matching host commands with:

```sh
PYA_ENABLE_ZIM_TOOLS=truth npm run setup:zim
```

The setup is opt-in. It installs the packages on Debian/Ubuntu hosts, builds
`pyash/zim-tools:ubuntu-24.04`, and verifies the required commands. Pyash's
current local conversion and read/search verbs call the host executables through
the existing command policy. The image is a portable tool environment for
other containerized workflows. Its default 48×48 archive illustration is at
`/usr/share/pyash/zim/archive-illustration.png`.

To run a command against files in the current directory:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  --volume "$PWD:/work" --workdir /work \
  pyash/zim-tools:ubuntu-24.04 zimdump --version
```

For web capture, Pyash uses the separate official Zimit image. Zimit includes
the browser crawler and `warc2zim`; `--keep` retains the WARC capture. For
serving a library, `containers/kiwix-server/compose.yaml` uses Kiwix's dedicated
server image and mounts the archive directory read-only.
