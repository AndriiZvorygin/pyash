// The ID3 tag at the head of an mp3.
//
// A song can carry its own name in the tag. The house gave the songs it made
// before the radio their real titles, and the station shows the title a file
// carries rather than the lane the file was named for.
//
// The tag is read and written here, and nowhere else: one place owns the
// bytes of the tag, so a title written once is a title every reader sees.
// The frames the house writes are the ones a player shows: who made the song,
// what it is called, the album it belongs to, when the audio was made, and
// a word about the song itself.

const HEADER_BYTES = 10;
const UTF8_ENCODING = 3;
const LANGUAGE = "eng";

const FRAME_FIELDS = [
  { key: "title", id: "TIT2" },
  { key: "artist", id: "TPE1" },
  { key: "album", id: "TALB" },
  { key: "date", id: "TDRC" },
  { key: "year", id: "TYER" },
  { key: "comment", id: "COMM" }
];

/**
 * Read a four byte size that is stored as seven bits per byte.
 */
function decodeSynchsafe(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return 0;
  return ((bytes[0] & 0x7f) << 21)
    | ((bytes[1] & 0x7f) << 14)
    | ((bytes[2] & 0x7f) << 7)
    | (bytes[3] & 0x7f);
}

/**
 * Write a size the way a tag stores it: seven bits per byte, so the highest
 * bit of every byte stays clear.
 */
function encodeSynchsafe(value) {
  const bytes = Buffer.alloc(4);
  bytes[0] = (value >>> 21) & 0x7f;
  bytes[1] = (value >>> 14) & 0x7f;
  bytes[2] = (value >>> 7) & 0x7f;
  bytes[3] = value & 0x7f;
  return bytes;
}

/**
 * The flags of the tag at the head of the buffer, minus one when there is no
 * tag at all.
 */
export function id3v2Flags(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES) return -1;
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) return -1;
  return buffer[5];
}

/**
 * Byte length of the ID3v2 tag at the head of the buffer, zero when there is
 * no tag. The size is stored as four seven-bit bytes, so the header has to be
 * read that way rather than as a plain integer.
 */
export function id3v2Size(buffer) {
  if (id3v2Flags(buffer) < 0) return 0;
  const flags = buffer[5];
  const size = decodeSynchsafe(buffer.subarray(6, 10));
  const footer = (flags & 0x10) ? HEADER_BYTES : 0;
  return HEADER_BYTES + size + footer;
}

/**
 * Swap the bytes of every pair, so a big endian text can be read as a little
 * endian one.
 */
function swap16(buffer) {
  const out = Buffer.from(buffer);
  for (let index = 0; index + 1 < out.length; index += 1) {
    const first = out[index];
    out[index] = out[index + 1];
    out[index + 1] = first;
  }
  return out;
}

/**
 * Read the text of a frame. The first byte says how the rest is written, and
 * the text ends at the first null.
 */
function decodeText(data) {
  if (!Buffer.isBuffer(data) || !data.length) return "";
  const encoding = data[0];
  const body = data.subarray(1);
  let text = "";
  if (encoding === 0) {
    text = body.toString("latin1");
  } else if (encoding === 1) {
    if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
      text = body.subarray(2).toString("utf16le");
    } else if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
      text = swap16(body.subarray(2)).toString("utf16le");
    } else {
      text = body.toString("utf16le");
    }
  } else if (encoding === 2) {
    text = swap16(body).toString("utf16le");
  } else {
    text = body.toString("utf8");
  }
  return text.replace(/\0[\s\S]*$/u, "").trim();
}

/**
 * Read a comment: the way it is written, the language it is in, the name of
 * the comment, and the comment itself.
 */
function decodeComment(data) {
  if (!Buffer.isBuffer(data) || data.length < 5) return "";
  const encoding = data[0];
  const body = data.subarray(4);
  const cut = body.indexOf(0);
  const text = cut >= 0 ? body.subarray(cut + 1) : body;
  return decodeText(Buffer.concat([Buffer.from([encoding]), text]));
}

/**
 * The frames of the tag at the head of the buffer. A frame is an id, a size
 * and the bytes of the frame; the walk stops at the first thing that is not a
 * frame, which is where the padding begins.
 */
export function id3Frames(buffer) {
  const frames = [];
  if (id3v2Flags(buffer) < 0) return frames;
  const version = buffer[3];
  const flags = buffer[5];
  const bodySize = decodeSynchsafe(buffer.subarray(6, 10));
  const bodyEnd = Math.min(buffer.length, HEADER_BYTES + bodySize);
  let offset = HEADER_BYTES;
  if (flags & 0x40) {
    // an extended header sits at the front of the body and has to be stepped over
    const raw = buffer.subarray(offset, offset + 4);
    const extended = version >= 4 ? decodeSynchsafe(raw) : raw.readUInt32BE(0) + 4;
    offset += Math.max(0, extended);
  }
  while (offset + 10 <= bodyEnd) {
    const id = buffer.subarray(offset, offset + 4).toString("latin1");
    if (!/^[A-Z0-9]{4}$/u.test(id)) break;
    const raw = buffer.subarray(offset + 4, offset + 8);
    const size = version >= 4 ? decodeSynchsafe(raw) : raw.readUInt32BE(0);
    const start = offset + 10;
    if (size < 0 || start + size > bodyEnd) break;
    frames.push({ id, data: buffer.subarray(start, start + size) });
    offset = start + size;
  }
  return frames;
}

/**
 * The text of one frame of the tag, empty when the tag does not carry it.
 */
export function readId3Frame(buffer, id) {
  const frame = id3Frames(buffer).find((entry) => entry.id === id);
  if (!frame) return "";
  return id === "COMM" ? decodeComment(frame.data) : decodeText(frame.data);
}

/**
 * The tags of the file, as a player reads them: the name of the song, who
 * made it, the album it belongs to, when the audio was made, and the word
 * about the song.
 */
export function readId3Tags(buffer) {
  const tags = {};
  for (const field of FRAME_FIELDS) {
    tags[field.key] = readId3Frame(buffer, field.id);
  }
  return tags;
}

/**
 * The title a file carries, empty when it carries none.
 */
export function readId3Title(buffer) {
  return readId3Frame(buffer, "TIT2");
}

/**
 * Build one frame: its id, its size and its bytes.
 */
function buildFrame(id, data) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, "latin1");
  encodeSynchsafe(data.length).copy(header, 4);
  return Buffer.concat([header, data]);
}

/**
 * The bytes of a text frame: how it is written, the text, and the end of it.
 */
function textFrameData(text) {
  return Buffer.concat([
    Buffer.from([UTF8_ENCODING]),
    Buffer.from(String(text ?? ""), "utf8"),
    Buffer.from([0])
  ]);
}

/**
 * The bytes of a comment frame: how it is written, the language it is in, the
 * empty name of the comment, the comment, and the end of it.
 */
function commentFrameData(text) {
  return Buffer.concat([
    Buffer.from([UTF8_ENCODING]),
    Buffer.from(LANGUAGE, "latin1"),
    Buffer.from([0]),
    Buffer.from(String(text ?? ""), "utf8"),
    Buffer.from([0])
  ]);
}

/**
 * The frames the given tags ask for, in the order a player reads them.
 *
 * A field that is null is removed from the file: a tag the house has decided
 * against does not linger.
 */
function tagFrames(tags = {}) {
  const frames = [];
  const removed = [];
  for (const field of FRAME_FIELDS) {
    const value = tags[field.key];
    if (value === null) {
      removed.push(field.id);
      continue;
    }
    const text = String(value ?? "").trim();
    if (!text) continue;
    const data = field.id === "COMM" ? commentFrameData(text) : textFrameData(text);
    frames.push({ id: field.id, data });
  }
  return { frames, removed };
}

/**
 * Give a file the tags of a song. The frames the file already carries are
 * kept, the frames of the given tags are replaced or added, and the audio is
 * untouched: the tag is written in front of the same bytes the station
 * already plays.
 *
 * A file whose tag carries flags the writer does not know is left alone
 * rather than rewritten from a guess.
 */
export function writeId3Tags(buffer, tags = {}) {
  const { frames: wanted, removed } = tagFrames(tags);
  if (!Buffer.isBuffer(buffer)) return buffer;
  if (!wanted.length && !removed.length) return buffer;
  const flags = id3v2Flags(buffer);
  if (flags > 0) return buffer;
  const present = flags === 0;
  const frames = present ? id3Frames(buffer) : [];
  const audio = present ? buffer.subarray(id3v2Size(buffer)) : buffer;
  const managed = new Set([...wanted.map((frame) => frame.id), ...removed]);
  const kept = frames.filter((frame) => !managed.has(frame.id));
  const body = Buffer.concat([
    ...kept.map((frame) => buildFrame(frame.id, frame.data)),
    ...wanted.map((frame) => buildFrame(frame.id, frame.data))
  ]);
  const header = Buffer.alloc(HEADER_BYTES);
  header[0] = 0x49;
  header[1] = 0x44;
  header[2] = 0x33;
  header[3] = 4;
  header[4] = 0;
  header[5] = 0;
  encodeSynchsafe(body.length).copy(header, 6);
  return Buffer.concat([header, body, audio]);
}
