import fs from "node:fs/promises";

// The channels of the station.
//
// A radio that plays one programme at one pace is a radio that never rests.
// The house wants a night programme as well as a day one, and a night programme
// is a different pace and a different voice, not a different name.
//
// A channel is one line of radio/channels.txt:
//
//   <name> | <engine> | <bpm> | <style> | <lane>, <lane>, ...
//
// The name is what a listener asks for: the stream of a channel is
// /<name>.mp3, a plain mp3 that any player can open. The engine is the voice
// that sings the channel, and the song it makes is named for it, so the night
// channel sings `night-peace.mp3` and the words of that song are the words of
// the peace lane.
//
// The tempo is what the songs of the channel are rendered at, and the style is
// what they are rendered in. A style of "-" is the style the workflow carries
// of its own.
//
// The lane list may be "*", which is every lane of radio/topics.txt.
//
// The first channel of the file is the default one: its stream is /stream.mp3,
// and the songs that came before the radio play in it. Every other channel
// sings in a voice of its own: its songs carry a sheet of their own, named for
// that voice, and are timed by their own hearing.

/**
 * The channels of the station, read from the text of the file.
 */
export function parseChannels(text) {
  const channels = [];
  for (const raw of String(text ?? "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [name, engine, bpm, style, lanes] = line.split("|").map((part) => String(part ?? "").trim());
    if (!name || !engine) continue;
    channels.push({
      name,
      engine,
      bpm: Number(bpm) > 0 ? Number(bpm) : 0,
      style: !style || style === "-" ? "" : style,
      lanes: lanes && lanes !== "*" ? lanes.split(",").map((lane) => lane.trim()).filter(Boolean) : [],
      everyLane: lanes === "*"
    });
  }
  return channels;
}

/**
 * The channels read from a file. A file that is not there leaves the station
 * with one channel: the house's own programme, at the pace it has always sung
 * at.
 */
export async function readChannels(file, { fallback = [] } = {}) {
  const name = String(file ?? "").trim();
  if (!name) return fallback;
  try {
    const channels = parseChannels(await fs.readFile(name, "utf8"));
    return channels.length ? channels : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The lanes a channel plays: the ones it names, or every lane of the house.
 */
export function channelLanes(channel, topics = []) {
  if (!channel) return [];
  if (channel.everyLane) return [...topics];
  return channel.lanes;
}

/**
 * The songs of a channel: its lanes in its own voice.
 */
export function channelSongs(channel, topics = []) {
  const engine = String(channel?.engine ?? "").trim();
  if (!engine) return [];
  return channelLanes(channel, topics).map((topic) => `${engine}-${topic}.mp3`);
}

/**
 * The programme of one channel: the songs it plays, in the order it plays
 * them, and the contract that keeps the other songs out.
 *
 * The default channel opens with the songs that came before the radio: they
 * are the songs the house made before the radio existed, and they open the
 * programme. Every other channel opens with its own lanes.
 *
 * A channel that is not the default one sings in a voice of its own, so its
 * songs carry a sheet of their own.
 */
export function channelProgramme({ channel = null, topics = [], house = [], default: isDefault = false } = {}) {
  const songs = channelSongs(channel, topics);
  const order = [];
  const contract = new Set();
  if (isDefault) {
    for (const name of house) {
      const song = String(name ?? "").trim();
      if (!song) continue;
      contract.add(song);
      order.push(song);
    }
  }
  for (const song of songs) {
    contract.add(song);
    order.push(song);
  }
  return {
    ...(channel ?? {}),
    default: isDefault,
    own: !isDefault,
    lanes: channelLanes(channel, topics),
    songs: order,
    contract
  };
}

/**
 * The channels of the station with the programme each of them plays.
 */
export function channelProgrammes({ channels = [], topics = [], house = [] } = {}) {
  const list = Array.isArray(channels) ? channels : [];
  return list.map((channel, index) => channelProgramme({
    channel,
    topics,
    house,
    default: index === 0
  }));
}

/**
 * The channel a listener asked for, and the one they get when they ask for
 * nothing: the default channel is the first one of the file.
 *
 * A name the station does not know falls back to the default channel, unless
 * the caller asks for the truth instead.
 */
export function channelByName(channels = [], name = "", { fallback = true } = {}) {
  const list = Array.isArray(channels) ? channels : [];
  const asked = String(name ?? "").trim();
  if (!asked) return list[0] ?? null;
  const found = list.find((channel) => channel.name === asked);
  if (found) return found;
  return fallback ? list[0] ?? null : null;
}
