import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  LYRICS_NODE_TYPES,
  REFERENCE_NODE_TYPES,
  SAMPLER_NODE_TYPES,
  SAVE_NODE_TYPES,
  STYLE_NODE_TYPES,
  camelize,
  detectInputPath,
  detectSaveFormat,
  isInterruptedExecution,
  formatMatchesExtension,
  mappingLookup,
  readAtPath,
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
  for (const name of ["audio_ace_step_1_5_xl_turbo", "audio_yue2_own_melody", "audio_ace_step_1_5_sft_voice"]) {
    const workflow = await readWorkflow(name);
    assert.ok(workflow?.prompt, `${name} must carry an API prompt graph`);
    const mapping = await readMappingPya(path.join(MUSIC_ROOT, `${name}.json`));
    assert.equal(mapping.lyricsPath, mapping.lyricsPath);
    assert.ok(mapping.lyricsPath, `${name} needs a lyrics path`);
    assert.ok(mapping.stylePath, `${name} needs a style path`);
    assert.ok(mapping.saveAudioPrefixPath, `${name} needs a save prefix path`);
  }
});

test("the voice workflow sings in a recording's timbre", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_sft_voice");
  const prompt = workflow.prompt;
  const byType = (type) => Object.entries(prompt).find(([, entry]) => entry.class_type === type);

  const generate = byType("AceStepSFTGenerate");
  assert.ok(generate, "the voice workflow generates with AceStepSFTGenerate");
  assert.equal(generate[1].inputs.reference_xl_attention, true);
  assert.equal(generate[1].inputs.reference_guidance_scale, 1.0);
  assert.equal(generate[1].inputs.reference_timbre_repeats, 1);

  const loader = byType("AceStepSFTLoadReferenceAudio");
  assert.ok(loader, "the voice workflow loads a reference voice");
  assert.deepEqual(generate[1].inputs.reference_audio, [loader[0], 0]);
  assert.equal(loader[1].inputs.enabled, false);
  assert.equal(loader[1].inputs.audio, "");

  const save = byType("SaveAudioMP3");
  assert.deepEqual(save[1].inputs.audio, [generate[0], 5]);
  assert.ok(!byType("VAEDecodeAudio"), "the generate node decodes its own audio");
});

test("the voice workflow carries no reference file of its own", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_sft_voice");
  for (const entry of Object.values(workflow.prompt)) {
    for (const value of Object.values(entry.inputs ?? {})) {
      if (typeof value !== "string") continue;
      assert.ok(
        !/\.(mp3|wav|flac|opus)$/iu.test(value),
        `the voice workflow depends on the input file ${value}`
      );
    }
  }
});

test("the voice mapping points at the reference nodes", async () => {
  const mapping = await readMappingPya(path.join(MUSIC_ROOT, "audio_ace_step_1_5_sft_voice.json"));
  assert.equal(mapping.lyricsPath, "47.inputs.lyrics");
  assert.equal(mapping.stylePath, "47.inputs.caption");
  assert.equal(mapping.durationPath, "47.inputs.duration");
  assert.equal(mapping.seedPath, "109.inputs.value");
  assert.equal(mapping.stepsPath, "3.inputs.steps");
  assert.equal(mapping.cfgPath, "3.inputs.cfg");
  assert.equal(mapping.cfgScalePath, "47.inputs.lm_cfg_scale");
  assert.equal(mapping.referenceAudioPath, "110.inputs.audio");
  assert.equal(mapping.referenceEnabledPath, "110.inputs.enabled");
  assert.equal(mapping.qualityPath, "107.inputs.quality");
  assert.equal(mapping.saveAudioPrefixPath, "107.inputs.filename_prefix");
});

test("a reference voice resolves without a mapping", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_sft_voice");
  assert.equal(
    detectInputPath(workflow, workflow.prompt, "audio", REFERENCE_NODE_TYPES),
    "110.inputs.audio"
  );
  assert.equal(
    detectInputPath(workflow, workflow.prompt, "enabled", REFERENCE_NODE_TYPES),
    "110.inputs.enabled"
  );
});

test("the ACE-Step mapping points at the reference graph nodes", async () => {
  const mapping = await readMappingPya(path.join(MUSIC_ROOT, "audio_ace_step_1_5_xl_turbo.json"));
  assert.equal(mapping.lyricsPath, "94.inputs.lyrics");
  assert.equal(mapping.stylePath, "94.inputs.tags");
  assert.equal(mapping.durationPath, "94.inputs.duration");
  assert.equal(mapping.secondsPath, "98.inputs.seconds");
  assert.equal(mapping.seedPath, "109.inputs.value");
  assert.equal(mapping.stepsPath, "3.inputs.steps");
  assert.equal(mapping.cfgPath, "3.inputs.cfg");
  assert.equal(mapping.samplerNamePath, "3.inputs.sampler_name");
  assert.equal(mapping.cfgScalePath, "94.inputs.cfg_scale");
  assert.equal(mapping.temperaturePath, "94.inputs.temperature");
  assert.equal(mapping.qualityPath, "107.inputs.quality");
  assert.equal(mapping.saveAudioPrefixPath, "107.inputs.filename_prefix");
});

test("the ACE-Step workflow is the reference graph, node for node", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_xl_turbo");
  const prompt = workflow.prompt;
  const byType = (type) => Object.entries(prompt).find(([, entry]) => entry.class_type === type);

  const sampler = byType("KSampler");
  assert.ok(sampler, "the reference graph samples with a KSampler");
  assert.equal(sampler[1].inputs.steps, 8);
  assert.equal(sampler[1].inputs.cfg, 1.0);
  assert.equal(sampler[1].inputs.sampler_name, "euler");
  assert.equal(sampler[1].inputs.scheduler, "simple");

  const flow = byType("ModelSamplingAuraFlow");
  assert.ok(flow, "the reference graph shifts the model with ModelSamplingAuraFlow");
  assert.equal(flow[1].inputs.shift, 3.0);
  assert.equal(flow[1].inputs.sampling, "flow");

  const encode = byType("TextEncodeAceStepAudio1.5");
  assert.ok(encode, "the reference graph encodes with TextEncodeAceStepAudio1.5");
  assert.equal(encode[1].inputs.cfg_scale, 2.0);
  assert.equal(encode[1].inputs.temperature, 0.85);
  assert.equal(encode[1].inputs.top_p, 0.9);
  assert.equal(encode[1].inputs.top_k, 0);

  const clip = byType("DualCLIPLoader");
  assert.ok(clip, "the reference graph loads both ACE text encoders");
  assert.equal(clip[1].inputs.clip_name2, "qwen_4b_ace15.safetensors");

  const save = byType("SaveAudioMP3");
  assert.ok(save, "the reference graph saves an mp3");
  assert.equal(save[1].inputs.quality, "V0");
  assert.ok(!byType("SaveAudioOpus"), "the station saves one file, not two");
});

test("one seed feeds both halves of the ACE-Step render", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_xl_turbo");
  const prompt = workflow.prompt;
  const seedNode = Object.entries(prompt).find(([, entry]) => entry.class_type === "PrimitiveInt");
  assert.ok(seedNode, "the reference graph keeps the seed in one node");
  const [seedId] = seedNode;
  const sampler = Object.entries(prompt).find(([, entry]) => entry.class_type === "KSampler");
  const encode = Object.entries(prompt).find(([, entry]) => entry.class_type === "TextEncodeAceStepAudio1.5");
  assert.deepEqual(sampler[1].inputs.seed, [seedId, 0]);
  assert.deepEqual(encode[1].inputs.seed, [seedId, 0]);
});

test("the ACE-Step length is written to the encoder and the latent alike", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_xl_turbo");
  const prompt = workflow.prompt;
  const encode = Object.entries(prompt).find(([, e]) => e.class_type === "TextEncodeAceStepAudio1.5");
  const latent = Object.entries(prompt).find(([, e]) => e.class_type === "EmptyAceStep1.5LatentAudio");
  assert.equal(encode[1].inputs.duration, 175.0);
  assert.equal(latent[1].inputs.seconds, 175.0);
});

test("the station style asks for an instant opening chorus", async () => {
  const workflow = await readWorkflow("audio_ace_step_1_5_xl_turbo");
  const prompt = workflow.prompt;
  const encode = Object.entries(prompt).find(([, e]) => e.class_type === "TextEncodeAceStepAudio1.5");
  const caption = encode[1].inputs.tags;
  assert.match(caption, /instant opening chorus/);
  assert.match(caption, /key change into final chorus/);

  const yue2 = await readWorkflow("audio_yue2_own_melody");
  const yue2Style = yue2.prompt["5"].inputs.style;
  assert.match(yue2Style, /instant opening chorus/);
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

test("detectInputPath finds the reference and YuE2 nodes", async () => {
  const aceStep = await readWorkflow("audio_ace_step_1_5_xl_turbo");
  const prompt = aceStep.prompt;
  assert.equal(detectInputPath(aceStep, prompt, "lyrics", LYRICS_NODE_TYPES), "94.inputs.lyrics");
  assert.equal(detectInputPath(aceStep, prompt, "tags", STYLE_NODE_TYPES), "94.inputs.tags");
  assert.equal(detectInputPath(aceStep, prompt, "steps", SAMPLER_NODE_TYPES), "3.inputs.steps");
  assert.equal(detectInputPath(aceStep, prompt, "filename_prefix", SAVE_NODE_TYPES), "107.inputs.filename_prefix");

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
  assert.equal(mappingLookup(aceStep, "cfgScalePath"), "94.inputs.cfg_scale");
  assert.equal(mappingLookup(aceStep, "temperaturePath"), "94.inputs.temperature");
  assert.equal(mappingLookup(aceStep, "samplerNamePath"), "3.inputs.sampler_name");
  assert.equal(mappingLookup(aceStep, "maxDurationPath"), "94.inputs.duration");
  assert.equal(mappingLookup(aceStep, "seedPath"), "109.inputs.value");

  const yue2 = await readMappingPya(path.join(MUSIC_ROOT, "audio_yue2_own_melody.json"));
  assert.equal(mappingLookup(yue2, "maxDurationPath"), "5.inputs.max_duration");
  assert.equal(mappingLookup(yue2, "repetitionPenaltyPath"), "5.inputs.repetition_penalty");
  assert.equal(mappingLookup(yue2, "topPPath"), "5.inputs.top_p");
  assert.equal(mappingLookup(yue2, "cfgScalePath"), "5.inputs.cfg_scale");
});

test("readAtPath reads a value back out of the prompt graph", () => {
  const prompt = { "3": { inputs: { seed: ["109", 0] } } };
  assert.deepEqual(readAtPath(prompt, "3.inputs.seed"), ["109", 0]);
  assert.equal(readAtPath(prompt, "3.inputs.missing"), undefined);
  assert.equal(readAtPath(prompt, "9.inputs.seed"), undefined);
});

test("the save node list knows the mp3 node the reference graph uses", () => {
  assert.ok(SAVE_NODE_TYPES.includes("SaveAudioMP3"));
  const prompt = { "107": { class_type: "SaveAudioMP3", inputs: { quality: "V0" } } };
  assert.equal(detectSaveFormat({}, prompt), "mp3");
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

test("isInterruptedExecution tells an interrupted render from a failed one", () => {
  const interrupted = {
    status: {
      messages: [
        ["execution_start", { prompt_id: "abc" }],
        ["execution_interrupted", { node_id: "5", node_type: "YuE2GenerateMusic" }]
      ]
    }
  };
  const failed = {
    status: {
      messages: [
        ["execution_start", { prompt_id: "abc" }],
        ["execution_error", { node_type: "KSampler", exception_message: "out of memory" }]
      ]
    }
  };
  assert.equal(isInterruptedExecution(interrupted), true);
  assert.equal(isInterruptedExecution(failed), false);
  assert.equal(isInterruptedExecution({}), false);
  assert.equal(isInterruptedExecution(null), false);
});
