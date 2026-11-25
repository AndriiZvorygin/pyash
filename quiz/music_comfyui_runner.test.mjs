import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  LYRICS_NODE_TYPES,
  SAMPLER_NODE_TYPES,
  SAVE_NODE_TYPES,
  STYLE_NODE_TYPES,
  camelize,
  detectInputPath,
  detectSaveFormat,
  formatMatchesExtension,
  mappingLookup,
  readMappingPya,
  setAtPath,
  sniffAudioFormat
} from "../command/music_comfyui_runner.mjs";

const MUSIC_ROOT = path.join(process.cwd(), "music", "comfyui");

async function readWorkflow(name) {
  const text = await fs.readFile(path.join(MUSIC_ROOT, `${name}.json`), "utf8");
  return JSON.parse(text);
}

test("the new music workflows ship with their mappings", async () => {
  for (const name of ["audio_ace_step_1_5_xl_turbo", "audio_yue2_own_melody"]) {
    const workflow = await readWorkflow(name);
    assert.ok(workflow?.prompt, `${name} must carry an API prompt graph`);
    const mapping = await readMappingPya(path.join(MUSIC_ROOT, `${name}.json`));
    assert.equal(mapping.lyricsPath, mapping.lyricsPath);
    assert.ok(mapping.lyricsPath, `${name} needs a lyrics path`);
    assert.ok(mapping.stylePath, `${name} needs a style path`);
    assert.ok(mapping.saveAudioPrefixPath, `${name} needs a save prefix path`);
  }
});

test("the ACE-Step mapping points at the SFT nodes", async () => {
  const mapping = await readMappingPya(path.join(MUSIC_ROOT, "audio_ace_step_1_5_xl_turbo.json"));
  assert.equal(mapping.lyricsPath, "4.inputs.lyrics");
  assert.equal(mapping.stylePath, "4.inputs.caption");
  assert.equal(mapping.durationPath, "4.inputs.duration");
  assert.equal(mapping.seedPath, "6.inputs.seed");
  assert.equal(mapping.stepsPath, "6.inputs.steps");
  assert.equal(mapping.cfgPath, "6.inputs.cfg");
  assert.equal(mapping.samplerNamePath, "6.inputs.sampler_name");
  assert.equal(mapping.qualityPath, "13.inputs.quality");
  assert.equal(mapping.saveAudioPrefixPath, "13.inputs.filename_prefix");
});

test("the YuE2 mapping points at the YuE2 nodes", async () => {
  const mapping = await readMappingPya(path.join(MUSIC_ROOT, "audio_yue2_own_melody.json"));
  assert.equal(mapping.lyricsPath, "5.inputs.lyrics");
  assert.equal(mapping.stylePath, "5.inputs.style");
  assert.equal(mapping.maxDurationPath, "5.inputs.max_duration");
  assert.equal(mapping.repetitionPenaltyPath, "5.inputs.repetition_penalty");
  assert.equal(mapping.stepsPath, "8.inputs.steps");
  assert.equal(mapping.saveAudioPrefixPath, "11.inputs.filename_prefix");
});

test("detectInputPath finds the SFT and YuE2 nodes", async () => {
  const aceStep = await readWorkflow("audio_ace_step_1_5_xl_turbo");
  const prompt = aceStep.prompt;
  assert.equal(detectInputPath(aceStep, prompt, "lyrics", LYRICS_NODE_TYPES), "4.inputs.lyrics");
  assert.equal(detectInputPath(aceStep, prompt, "caption", STYLE_NODE_TYPES), "4.inputs.caption");
  assert.equal(detectInputPath(aceStep, prompt, "steps", SAMPLER_NODE_TYPES), "6.inputs.steps");
  assert.equal(detectInputPath(aceStep, prompt, "filename_prefix", SAVE_NODE_TYPES), "13.inputs.filename_prefix");

  const yue2 = await readWorkflow("audio_yue2_own_melody");
  assert.equal(detectInputPath(yue2, yue2.prompt, "lyrics", LYRICS_NODE_TYPES), "5.inputs.lyrics");
  assert.equal(detectInputPath(yue2, yue2.prompt, "style", STYLE_NODE_TYPES), "5.inputs.style");
  assert.equal(detectInputPath(yue2, yue2.prompt, "steps", SAMPLER_NODE_TYPES), "8.inputs.steps");
  assert.equal(detectInputPath(yue2, yue2.prompt, "filename_prefix", SAVE_NODE_TYPES), "11.inputs.filename_prefix");
});

test("detectInputPath keeps the old AIO workflow working", async () => {
  const legacy = await readWorkflow("audio_ace_step_1_5_checkpoint");
  const prompt = legacy.prompt ?? legacy;
  assert.equal(detectInputPath(legacy, prompt, "lyrics", LYRICS_NODE_TYPES), "94.inputs.lyrics");
});

test("setAtPath writes into the prompt graph", () => {
  const prompt = { "4": { inputs: { lyrics: "" } } };
  setAtPath(prompt, "4.inputs.lyrics", "new words");
  assert.equal(prompt["4"].inputs.lyrics, "new words");
});

test("camelize turns option names into canonical keys", () => {
  assert.equal(camelize("voice_boost"), "voiceBoost");
  assert.equal(camelize("lm_cfg_scale"), "lmCfgScale");
  assert.equal(camelize("sampler_name"), "samplerName");
  assert.equal(camelize("bpm"), "bpm");
});

test("mappingLookup meets the word spelling with the camel spelling", () => {
  const mapping = { voiceboostPath: "6.inputs.voice_boost", saveAudioPrefixPath: "13.inputs.filename_prefix" };
  assert.equal(mappingLookup(mapping, "voiceBoostPath"), "6.inputs.voice_boost");
  assert.equal(mappingLookup(mapping, "voiceboostPath"), "6.inputs.voice_boost");
  assert.equal(mappingLookup(mapping, "saveAudioPrefixPath"), "13.inputs.filename_prefix");
  assert.equal(mappingLookup(mapping, "missingPath"), null);
  assert.equal(mappingLookup(null, "lyricsPath"), null);
});

test("the mapping files answer to the runner's canonical option names", async () => {
  const aceStep = await readMappingPya(path.join(MUSIC_ROOT, "audio_ace_step_1_5_xl_turbo.json"));
  assert.equal(mappingLookup(aceStep, "voiceBoostPath"), "6.inputs.voice_boost");
  assert.equal(mappingLookup(aceStep, "lmCfgScalePath"), "4.inputs.lm_cfg_scale");
  assert.equal(mappingLookup(aceStep, "samplerNamePath"), "6.inputs.sampler_name");

  const yue2 = await readMappingPya(path.join(MUSIC_ROOT, "audio_yue2_own_melody.json"));
  assert.equal(mappingLookup(yue2, "maxDurationPath"), "5.inputs.max_duration");
  assert.equal(mappingLookup(yue2, "repetitionPenaltyPath"), "5.inputs.repetition_penalty");
  assert.equal(mappingLookup(yue2, "topPPath"), "5.inputs.top_p");
  assert.equal(mappingLookup(yue2, "cfgScalePath"), "5.inputs.cfg_scale");
});

test("detectSaveFormat reads the container the save node will write", async () => {
  for (const name of ["audio_ace_step_1_5_xl_turbo", "audio_yue2_own_melody"]) {
    const workflow = await readWorkflow(name);
    const prompt = workflow.prompt ?? workflow;
    assert.equal(detectSaveFormat(workflow, prompt), "mp3");
  }
});

test("sniffAudioFormat reads the container out of the bytes", () => {
  assert.equal(sniffAudioFormat(Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00])), "mp3");
  assert.equal(sniffAudioFormat(Buffer.from([0xff, 0xfb, 0x90, 0x00])), "mp3");
  assert.equal(sniffAudioFormat(Buffer.from("fLaC0000", "latin1")), "flac");
  assert.equal(sniffAudioFormat(Buffer.from("RIFF0000", "latin1")), "wav");
  const opus = Buffer.concat([Buffer.from("OggS", "latin1"), Buffer.alloc(24), Buffer.from("OpusHead", "latin1")]);
  assert.equal(sniffAudioFormat(opus), "opus");
  assert.equal(sniffAudioFormat(Buffer.from("not audio at all", "latin1")), "unknown");
});

test("formatMatchesExtension refuses a file whose bytes are not the named format", () => {
  assert.ok(formatMatchesExtension("mp3", "mp3"));
  assert.ok(formatMatchesExtension("unknown", "mp3"));
  assert.ok(formatMatchesExtension("opus", "ogg"));
  assert.ok(!formatMatchesExtension("flac", "mp3"));
  assert.ok(!formatMatchesExtension("mp3", "flac"));
});

test("the ACE-Step workflow carries no file from the ComfyUI input folder", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_xl_turbo");
  const prompt = workflow.prompt;
  for (const entry of Object.values(prompt)) {
    for (const value of Object.values(entry.inputs ?? {})) {
      if (typeof value !== "string") continue;
      assert.ok(
        !/\.(mp3|wav|flac|opus)$/iu.test(value),
        `workflow node ${entry.class_type} depends on the input file ${value}`
      );
    }
  }
});
