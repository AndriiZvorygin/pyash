import path from "node:path";

// A song a listener may take home.
//
// The station listens to the open internet, so a download is a thing a
// stranger asks for. Two rules keep that safe: the route only ever serves a
// song the station is actually playing, and the file it serves is named by
// the catalogue, never by the stranger's own path. A name that carries a
// separator or a parent step is refused before anything touches the disk.

export const DOWNLOAD_PREFIX = "/song/";

// A song a listener may hear in the page.
//
// The download route hands a stranger a file. A listener who picks a song out
// of the catalogue wants to hear it where they are, not to save it, so the song
// is served the same way with a name a player opens instead of a name a browser
// saves. The guards are the download's own: only a song of the catalogue, only
// a plain file name, never a path.
export const LISTEN_PREFIX = "/listen/";

/**
 * The url a song is heard from, in the page's own player.
 */
export function listenUrlFor(filename) {
  const name = String(filename ?? "").trim();
  if (!name) return "";
  return `${LISTEN_PREFIX}${encodeURIComponent(name)}`;
}

/**
 * The url a song is downloaded from.
 */
export function downloadUrlFor(filename) {
  const name = String(filename ?? "").trim();
  if (!name) return "";
  return `${DOWNLOAD_PREFIX}${encodeURIComponent(name)}`;
}

/**
 * The song name a download path asks for, or nothing when the path asks for
 * something that is not a plain file name.
 */
export function downloadNameFromPath(pathname) {
  const raw = String(pathname ?? "");
  if (!raw.startsWith(DOWNLOAD_PREFIX)) return "";
  const asked = raw.slice(DOWNLOAD_PREFIX.length);
  if (!asked) return "";
  let name = "";
  try {
    name = decodeURIComponent(asked);
  } catch {
    return "";
  }
  if (!name) return "";
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return "";
  if (name === "." || name === "..") return "";
  return name;
}

/**
 * Where a download of that name lives, inside the catalogue folder and
 * nowhere else.
 */
export function resolveDownloadPath({ catalogueDirectory, filename }) {
  const folder = path.resolve(String(catalogueDirectory ?? ""));
  const name = String(filename ?? "").trim();
  if (!folder || !name) return "";
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return "";
  if (name === "." || name === "..") return "";
  const target = path.resolve(folder, name);
  if (target !== folder && !target.startsWith(folder + path.sep)) return "";
  return target;
}

/**
 * The name a download is given: the name of the song, when the song has one
 * of its own, and the name of the file in the catalogue otherwise.
 *
 * A name that cannot be written in a header is left out, so a strange title
 * never breaks the download it names.
 */
export function downloadNameFor(track) {
  const fallback = String(track?.filename ?? "").trim();
  const title = String(track?.title ?? "").trim();
  if (!title || /[^\x20-\x7e]/u.test(title)) return fallback;
  const name = `${title}.mp3`.replace(/["\\/]/gu, "");
  return name || fallback;
}
