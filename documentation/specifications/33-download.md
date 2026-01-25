# `33-download.md` (draft v0.1)

This document defines the `download` verb as a **signature-first** tool for pulling remote content into local files.
It is designed to avoid backend dispatch inside the verb body by encoding transport and intent in cases.

## 1. Canonical verb shape

```
be download fromstate <scheme> from filename <url> [as wo <intent>] [to filename <path>] do
```

- `fromstate` encodes the transport/scheme (`http`, `https`, `magnet`, `ipfs`).
- `from filename` carries the URL (text payload; not a local filename).
- `as wo` encodes the intent (`video`, `audio`, `web`, `file`) and maps to the backend choice.
- `to filename` is the local output path (optional; defaults to current working directory).

## 2. Scheme and intent vocabulary

**Schemes (`fromstate`):**
- `http`
- `https`
- `magnet`
- `ipfs`

**Intents (`as wo`):**
- `video`
- `audio`
- `web`
- `file`

Notes:
- `as wo` is optional when the scheme has a single backend (e.g., `magnet`, `ipfs`).
- `as wo` is required when multiple backends are valid for the scheme (e.g., `http`, `https`).
- `ob wo all` MAY be used to request a multi-item download (playlists/channels/feeds).

## 3. Signature-first dispatch (normative)

Each backend registers its own signature. Examples:

```
be download fromstate magnet from filename filename to filename filename do
be download fromstate ipfs from filename filename to filename filename do
be download fromstate https from filename filename as wo video to filename filename do
be download fromstate https from filename filename as wo web to filename filename do
```

Dispatch MUST be signature-first. Backends MUST NOT switch on URL contents inside the verb body.

## 4. URL normalization (sugar)

Implementations MAY support a sugar form that infers `fromstate` from the URL **before signature derivation**:

```
be download from filename "https://example.com/file.zip" as wo file to filename "out.zip" do
```

Normalization rules (normative):
- `magnet:` → `fromstate magnet`
- `ipfs://` or `ipfs:` → `fromstate ipfs`
- `http://` → `fromstate http`
- `https://` → `fromstate https`

If inference fails, the call MUST error (`download defective: missing fromstate`).

## 5. Output contract

On success, return:

```
su name <result> ob filename "<path>" be download ya
```

On failure, return:

```
su name download defective ob text "<reason>" from name download be error ya
```

## 6. Tooling boundaries

Suggested backend mapping (non-normative):
- `http/https + video|audio` → `yt-dlp`
- `http/https + web|file` → `curl` (or equivalent)
- `magnet` → torrent client
- `ipfs` → ipfs client

Backends live as modules or command helpers. Keep side effects localized.

## 6.1 Optional cases (download-specific)

These cases are interpreted by the download backend and do not change global grammar.

* `ob wo all` — download multiple items when the source is a playlist/channel/feed.
* `during months <n>` — restrict downloads to the last `<n>` months (backend-specific).

If `to filename` is omitted, the backend MUST write into the current working directory,
using its default naming template.

Additional backend arguments MAY be supplied via defaults, e.g.:

```
su name download extra ob ve text "--cookies-from-browser firefox" ya
```

## 7. Example sentences

```
be download fromstate https from filename "https://example.com/file.zip" as wo file to filename "out/file.zip" do
be download fromstate https from filename "https://escribemeetings.com/..." as wo audio to filename "out/audio.mp3" do
be download fromstate magnet from filename "magnet:?xt=urn:btih:..." to filename "out.torrent" do
be download fromstate ipfs from filename "ipfs://bafy..." to filename "out.bin" do
```

Sugar example (pre-dispatch normalization):
```
be download from filename "https://example.com/file.zip" as wo file to filename "out/file.zip" do
```

Playlist/channel example (download all items from last month into CWD):
```
be download ob wo all during months 1 from filename "https://www.youtube.com/@AndriiZ/videos" as wo audio do
```
