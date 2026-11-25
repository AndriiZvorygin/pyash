// A small MPEG audio reader. The station plays the rendered catalogue as it
// stands, so it has to know where the audio starts inside a file and how long
// the file lasts. Both answers come from the frames themselves: no encoder, no
// external probe, no state on disk.

const BITRATE_TABLES = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
};

const SAMPLE_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
};

const ID3_HEADER_BYTES = 10;

/**
 * Byte length of the ID3v2 tag at the head of the buffer, zero when there is
 * no tag. The size is stored as four seven-bit bytes, so the header has to be
 * read that way rather than as a plain integer.
 */
export function id3v2Size(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < ID3_HEADER_BYTES) return 0;
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) return 0;
  const flags = buffer[5];
  const size = ((buffer[6] & 0x7f) << 21)
    | ((buffer[7] & 0x7f) << 14)
    | ((buffer[8] & 0x7f) << 7)
    | (buffer[9] & 0x7f);
  const footer = (flags & 0x10) ? ID3_HEADER_BYTES : 0;
  return ID3_HEADER_BYTES + size + footer;
}

/**
 * Read one MPEG audio frame header at the given offset. Returns null when the
 * bytes are not a frame the reader understands, which is also how the walk
 * knows it has reached the end of the audio.
 */
export function parseFrameHeader(buffer, offset = 0) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || offset + 4 > buffer.length) return null;
  const first = buffer[offset];
  const second = buffer[offset + 1];
  const third = buffer[offset + 2];
  const fourth = buffer[offset + 3];
  if (first !== 0xff || (second & 0xe0) !== 0xe0) return null;
  const versionBits = (second >> 3) & 0x03;
  if (versionBits === 1) return null;
  const layerBits = (second >> 1) & 0x03;
  if (layerBits === 0) return null;
  const layer = 4 - layerBits;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15) return null;
  if (sampleRateIndex === 3) return null;
  const versionKey = versionBits === 3 ? "1" : "2";
  const bitrateKbps = BITRATE_TABLES[`${versionKey}-${layer}`][bitrateIndex];
  if (!bitrateKbps) return null;
  const sampleRate = SAMPLE_RATES[versionBits][sampleRateIndex];
  const padding = (third >> 1) & 0x01;
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : versionBits === 3 ? 1152 : 576;
  let frameBytes = 0;
  if (layer === 1) {
    frameBytes = Math.floor((12 * bitrateKbps * 1000) / sampleRate + padding) * 4;
  } else if (versionBits === 3) {
    frameBytes = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
  } else {
    frameBytes = Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;
  }
  if (frameBytes < 4) return null;
  const mode = (fourth >> 6) & 0x03;
  return {
    layer,
    versionBits,
    bitrateKbps,
    sampleRate,
    samplesPerFrame,
    frameBytes,
    channels: mode === 3 ? 1 : 2,
    mode
  };
}

/**
 * Offset of the first frame the reader can play. The ID3 tag comes first, and
 * a renderer may leave a little padding after it, so the search walks forward
 * a bounded distance before giving up.
 */
export function firstFrameOffset(buffer, { searchBytes = 4096 } = {}) {
  const start = id3v2Size(buffer);
  const limit = Math.min(buffer.length, start + searchBytes);
  for (let offset = start; offset + 4 <= limit; offset += 1) {
    const header = parseFrameHeader(buffer, offset);
    if (!header) continue;
    if (offset + header.frameBytes > buffer.length) continue;
    return offset;
  }
  return start;
}

/**
 * Measure an mp3 buffer: where the audio starts, how long it runs and the
 * shape of the stream. A buffer without frames measures as empty rather than
 * as a broken file.
 *
 * The frame offsets and the length of one frame are returned as well, because
 * the station needs them to play the audio in real time: every MPEG layer
 * three frame carries the same number of samples, so the frame index is the
 * clock.
 */
export function measureMp3Buffer(buffer) {
  const empty = {
    dataOffset: 0,
    durationSeconds: 0,
    sampleRate: 0,
    channels: 0,
    bitrateKbps: 0,
    frames: 0,
    frameSeconds: 0,
    frameOffsets: new Int32Array(0),
    bytes: Buffer.isBuffer(buffer) ? buffer.length : 0
  };
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return empty;
  const dataOffset = firstFrameOffset(buffer);
  const offsets = [];
  let offset = dataOffset;
  let samples = 0;
  let frames = 0;
  let sampleRate = 0;
  let channels = 0;
  let bitrateKbps = 0;
  let frameSamples = 0;
  while (offset + 4 <= buffer.length) {
    const header = parseFrameHeader(buffer, offset);
    if (!header) break;
    if (offset + header.frameBytes > buffer.length) break;
    if (!sampleRate) {
      sampleRate = header.sampleRate;
      channels = header.channels;
      bitrateKbps = header.bitrateKbps;
      frameSamples = header.samplesPerFrame;
    }
    offsets.push(offset);
    samples += header.samplesPerFrame;
    frames += 1;
    offset += header.frameBytes;
  }
  if (!frames) return { ...empty, dataOffset };
  return {
    dataOffset,
    durationSeconds: samples / sampleRate,
    sampleRate,
    channels,
    bitrateKbps,
    frames,
    frameSeconds: frameSamples / sampleRate,
    frameOffsets: Int32Array.from(offsets),
    bytes: buffer.length
  };
}

/**
 * Read an mp3 file and measure it. The file is read whole: the station scans
 * a handful of tracks and the walk needs every frame.
 */
export async function measureMp3File(filePath) {
  const fs = await import("node:fs/promises");
  const buffer = await fs.readFile(filePath);
  return measureMp3Buffer(buffer);
}
