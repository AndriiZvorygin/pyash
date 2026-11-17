import init, {
  numeric_batch_demo_pack_bytes,
  conditional_number_demo_pack_bytes,
  run_demo_pack,
  run_pack,
  run_pack_webgpu,
} from "./pkg/pyac_browser.js";

const demoButton = document.querySelector("#demo");
const cpuBatchButton = document.querySelector("#cpu-batch");
const gpuDemoButton = document.querySelector("#gpu-demo");
const conditionalDemoButton = document.querySelector("#conditional-demo");
const packInput = document.querySelector("#pack");
const gpuPackButton = document.querySelector("#gpu-pack");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
let selectedPackBytes;

function showResponse(responseText) {
  const response = JSON.parse(responseText);
  result.textContent = JSON.stringify(response, null, 2);
  status.textContent = response.ok ? "Pack executed successfully." : "Pack execution failed.";
}

try {
  await init();
  demoButton.disabled = false;
  cpuBatchButton.disabled = false;
  gpuDemoButton.disabled = false;
  conditionalDemoButton.disabled = false;
  packInput.disabled = false;
  status.textContent = "WASM runtime ready.";
} catch (error) {
  status.textContent = `Could not load WASM runtime: ${error}`;
}

demoButton.addEventListener("click", () => showResponse(run_demo_pack()));
cpuBatchButton.addEventListener("click", () => {
  showResponse(run_pack(numeric_batch_demo_pack_bytes()));
});

async function tryWebGpu(packBytes) {
  status.textContent = "Submitting VLIW pack to WebGPU…";
  try {
    showResponse(await run_pack_webgpu(packBytes));
  } catch (error) {
    showResponse(run_pack(packBytes));
    status.textContent = `WebGPU unavailable or pack ineligible; showed WASM CPU result. ${error}`;
  }
}

gpuDemoButton.addEventListener("click", () => tryWebGpu(numeric_batch_demo_pack_bytes()));
conditionalDemoButton.addEventListener("click", () => tryWebGpu(conditional_number_demo_pack_bytes()));

packInput.addEventListener("change", async () => {
  const file = packInput.files?.[0];
  if (!file) return;
  selectedPackBytes = new Uint8Array(await file.arrayBuffer());
  gpuPackButton.disabled = false;
  status.textContent = `Running ${file.name}…`;
  showResponse(run_pack(selectedPackBytes));
});

gpuPackButton.addEventListener("click", () => {
  if (selectedPackBytes) void tryWebGpu(selectedPackBytes);
});
