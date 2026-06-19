import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { normalizePromptObject } from "../command/draw_comfyui_runner.mjs";

test("zvorygin image edit workflow has pyash draw annotation", async () => {
  const annotation = await fs.readFile(
    "draw/comfyui/andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled.pya",
    "utf8"
  );
  assert.match(annotation, /su name positive prompt path ob text "75074\.inputs\.text" ya/u);
  assert.match(annotation, /su name save image prefix path ob text "9\.inputs\.filename_prefix" ya/u);
  assert.match(annotation, /su name width path ob text "75062\.inputs\.width" ya/u);
  assert.match(annotation, /su name width path ob text "75066\.inputs\.width" ya/u);
  assert.match(annotation, /su name height path ob text "75062\.inputs\.height" ya/u);
  assert.match(annotation, /su name height path ob text "75066\.inputs\.height" ya/u);

  const workflow = JSON.parse(await fs.readFile(
    "draw/comfyui/andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled.json",
    "utf8"
  ));
  const promptNode = workflow.nodes.find((node) => Number(node?.id) === 75);
  const saveNode = workflow.nodes.find((node) => Number(node?.id) === 9);
  assert.equal(promptNode?.inputs?.some((input) => input?.name === "text"), true);
  assert.equal(saveNode?.type, "SaveImage");
});

test("draw runner preserves embedded LoadImage filenames in UI workflows", async () => {
  const workflow = JSON.parse(await fs.readFile(
    "draw/comfyui/andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled.json",
    "utf8"
  ));
  const prompt = normalizePromptObject(workflow);
  assert.equal(prompt["76"]?.inputs?.image, "Andrii-Zvorygin-no-background-Flux2-Klein_00075_.png");
  assert.equal(prompt["76"]?.inputs?.upload, "image");
  assert.equal(prompt["75074"]?.class_type, "CLIPTextEncode");
  assert.deepEqual(prompt["75080"]?.inputs?.image, ["76", 0]);
  assert.deepEqual(prompt["9"]?.inputs?.images, ["75065", 0]);
  assert.equal(prompt["9"]?.inputs?.filename_prefix, "Flux2-Klein");
  assert.equal(prompt["75080"]?.inputs?.upscale_method, "nearest-exact");
  assert.equal(prompt["75080"]?.inputs?.resolution_steps, 1);
  assert.equal(prompt["75080"]?.inputs?.megapixels, 1);
  assert.equal(prompt["75070"]?.inputs?.weight_dtype, "default");
  assert.equal(prompt["75071"]?.inputs?.type, "flux2");
  assert.equal(prompt["75071"]?.inputs?.device, "default");
  assert.equal(prompt["75061"]?.inputs?.sampler_name, "euler");
  assert.deepEqual(prompt["75062"]?.inputs?.width, ["75099", 0]);
  assert.deepEqual(prompt["75062"]?.inputs?.height, ["75099", 1]);
  assert.deepEqual(prompt["75066"]?.inputs?.width, ["75099", 0]);
  assert.deepEqual(prompt["75066"]?.inputs?.height, ["75099", 1]);
  assert.equal(prompt["75062"]?.inputs?.steps, 4);
  assert.equal(prompt["75063"]?.inputs?.cfg, 1);
  assert.equal(prompt["75073"]?.inputs?.control_after_generate, "randomize");
  assert.equal(prompt["75066"]?.inputs?.batch_size, 1);
  assert.equal(prompt["75"], undefined);
  assert.equal(prompt["92"], undefined);
  assert.equal(prompt["97"], undefined);
});


test("draw-zvorygin image-edit example keeps only scene paragraph swappable", async () => {
  const source = await fs.readFile("examples/pyash/draw-zvorygin-image-edit.pya", "utf8");
  assert.match(source, /ob text text scene be input ya/u);
  assert.match(source, /same guy but cartoony, one Andrii only: broad pale canvas gardener hat, mostly straight long brown hair tucked under it, with a few strands visible, long brown auburn beard with copper tones/u);
  assert.match(source, /\[\[scene\]\]/u);
  assert.match(source, /no severed body parts\. no extra limbs\. no bad eyes\. irises visible./u);
  assert.match(source, /zvorygin image edit replacements/u);
  assert.match(source, /as text "andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled" be draw do/u);
});


test("draw-zvorygin simple image-edit example accepts the middle scene as input", async () => {
  const source = await fs.readFile("examples/pyash/draw-zvorygin-image-edit-simple.pya", "utf8");
  assert.match(source, /ob text text scene be input ya/u);
  assert.match(source, /same guy but cartoony, one Andrii only: broad pale canvas gardener hat, mostly straight long brown hair tucked under it, with a few strands visible, long brown auburn beard with copper tones/u);
  assert.match(source, /\[\[scene\]\]/u);
  assert.match(source, /no severed body parts\. no extra limbs\. no bad eyes\. irises visible./u);
  assert.match(source, /zvorygin image edit replacements/u);
  assert.match(source, /to filename "examples\/out\/zvorygin-image-edit-simple\.png"/u);
  assert.match(source, /as text "andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled" be draw do/u);
});
