import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { buildVliwGpuConformanceCases } from "../../command/vliw_gpu_conformance.mjs";

const root = resolve(fileURLToPath(new URL("./web/", import.meta.url)));
const generatedModule = resolve(root, "pkg/pyac_browser.js");
assert.ok(existsSync(generatedModule), "run build.sh before the browser smoke");
const programletCases = buildVliwGpuConformanceCases()
  .filter(({ kind }) => kind === "programlet")
  .map(({ name, pack, expectedValues }) => ({
    name,
    pack: [...pack],
    expectedValues,
  }));

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

async function benchmarkBrowserBatches(page, moduleUrl) {
  return page.evaluate(async (url) => {
    const { numeric_batch_demo_pack_bytes, run_pack, run_pack_webgpu } = await import(url);
    const seed = numeric_batch_demo_pack_bytes();
    const sourceCount = new DataView(seed.buffer, seed.byteOffset, seed.byteLength).getUint32(16, true);
    const makePack = (count) => {
      const bytes = new Uint8Array(32 + count * 32);
      bytes.set(seed.subarray(0, 32));
      const header = new DataView(bytes.buffer);
      header.setUint32(16, count, true);
      header.setUint32(24, bytes.byteLength, true);
      for (let index = 0; index < count; index += 1) {
        const sourceIndex = index % sourceCount;
        const start = 32 + sourceIndex * 32;
        bytes.set(seed.subarray(start, start + 32), 32 + index * 32);
      }
      return bytes;
    };
    const median = (values) => values.sort((left, right) => left - right)[Math.floor(values.length / 2)];
    const measurements = [];

    for (const count of [1024, 8192, 32768, 65536, 131072]) {
      const pack = makePack(count);
      const cpuWarm = JSON.parse(run_pack(pack));
      const gpuWarm = JSON.parse(await run_pack_webgpu(pack));
      if (!cpuWarm.ok || !gpuWarm.ok || JSON.stringify(cpuWarm.values) !== JSON.stringify(gpuWarm.values)) {
        throw new Error(`benchmark parity failed at ${count} codelets`);
      }

      const cpuTimes = [];
      const gpuTimes = [];
      for (let repeat = 0; repeat < 7; repeat += 1) {
        const timeCpu = () => {
          const start = performance.now();
          JSON.parse(run_pack(pack));
          cpuTimes.push(performance.now() - start);
        };
        const timeGpu = async () => {
          const start = performance.now();
          JSON.parse(await run_pack_webgpu(pack));
          gpuTimes.push(performance.now() - start);
        };
        if (repeat % 2 === 0) {
          timeCpu();
          await timeGpu();
        } else {
          await timeGpu();
          timeCpu();
        }
      }
      const cpuMedianMs = median(cpuTimes);
      const webGpuMedianMs = median(gpuTimes);
      measurements.push({
        codelets: count,
        cpuMedianMs: Number(cpuMedianMs.toFixed(3)),
        webGpuMedianMs: Number(webGpuMedianMs.toFixed(3)),
        speedup: Number((cpuMedianMs / webGpuMedianMs).toFixed(3)),
      });
    }
    return measurements;
  }, moduleUrl);
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const path = resolve(root, pathname === "/" ? "./index.html" : `.${pathname}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  createReadStream(path)
    .on("error", () => response.writeHead(404).end("not found"))
    .on("open", () => response.writeHead(200, {
      "content-type": contentTypes.get(extname(path)) ?? "application/octet-stream",
    }))
    .pipe(response);
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();
const generatedModuleUrl = `http://127.0.0.1:${port}/pkg/pyac_browser.js`;
const executablePath = process.env.PYA_CHROMIUM_PATH
  ?? (existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan"],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`);
  const rawGpuProbe = await page.evaluate(async () => {
    try {
      if (!navigator.gpu) return { available: false };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { available: false, adapter: null };
      const device = await adapter.requestDevice();
      const shader = device.createShaderModule({ code: "@group(0) @binding(0) var<storage, read_write> result: array<u32>; @compute @workgroup_size(1) fn main() { result[0] = 123u; }" });
      const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: shader, entryPoint: "main" } });
      const output = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, 4);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const value = new Uint32Array(readback.getMappedRange().slice(0))[0];
      return { available: true, adapter: adapter.info?.description ?? adapter.info?.vendor ?? "unknown", value };
    } catch (error) {
      return { available: false, error: String(error) };
    }
  });
  process.stdout.write(`raw WebGPU probe: ${JSON.stringify(rawGpuProbe)}\n`);
  if (rawGpuProbe.available) assert.equal(rawGpuProbe.value, 123);
  await page.getByRole("button", { name: "Run one-plus-one demo" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#demo").disabled === false);
  await page.locator("#demo").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Pack executed successfully.");

  const result = JSON.parse(await page.locator("#result").textContent());
  assert.equal(result.ok, true);
  assert.deepEqual(result.values, [{ type: "unsigned", value: 2 }]);

  await page.locator("#cpu-batch").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Pack executed successfully.");
  const cpuBatch = JSON.parse(await page.locator("#result").textContent());
  assert.equal(cpuBatch.backend, "wasm-cpu");

  await page.locator("#gpu-demo").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent !== "Submitting VLIW pack to WebGPU…");
  const selectedBackendResult = JSON.parse(await page.locator("#result").textContent());
  const selectedBackendStatus = await page.locator("#status").textContent();
  assert.equal(selectedBackendResult.ok, true);
  assert.deepEqual(
    selectedBackendResult.values,
    cpuBatch.values,
    `backend result: ${JSON.stringify(selectedBackendResult)}`,
  );
  assert.ok(["webgpu", "wasm-cpu"].includes(selectedBackendResult.backend));
  assert.equal(
    selectedBackendResult.backend,
    rawGpuProbe.available ? "webgpu" : "wasm-cpu",
    `selected GPU action did not match the raw adapter probe: ${selectedBackendStatus}; result=${JSON.stringify(selectedBackendResult)}`,
  );
  const programletParity = await page.evaluate(async ({ gpuAvailable, moduleUrl, cases }) => {
    const { run_pack, run_pack_webgpu } = await import(moduleUrl);
    const results = [];
    for (const testCase of cases) {
      const bytes = new Uint8Array(testCase.pack);
      const cpu = JSON.parse(run_pack(bytes));
      const gpu = gpuAvailable ? JSON.parse(await run_pack_webgpu(bytes)) : null;
      results.push({ name: testCase.name, expectedValues: testCase.expectedValues, cpu, gpu });
    }
    return results;
  }, {
    gpuAvailable: selectedBackendResult.backend === "webgpu",
    moduleUrl: generatedModuleUrl,
    cases: programletCases,
  });
  for (const result of programletParity) {
    assert.equal(result.cpu.ok, true, `${result.name}: WASM CPU rejected the pack`);
    assert.deepEqual(result.cpu.values, result.expectedValues, `${result.name}: WASM CPU differs from spec`);
    if (result.gpu) {
      assert.equal(result.gpu.backend, "webgpu", `${result.name}: WebGPU did not execute the pack`);
      assert.deepEqual(result.gpu.values, result.expectedValues, `${result.name}: WebGPU differs from spec`);
    }
  }

  let measurements = [];
  if (selectedBackendResult.backend === "webgpu") {
    assert.ok(selectedBackendResult.device, "WebGPU response reports its adapter");
    measurements = await benchmarkBrowserBatches(page, generatedModuleUrl);
  } else {
    assert.match(selectedBackendStatus, /WebGPU unavailable/);
  }

  const vectorParity = await page.evaluate(async ({ gpuAvailable, moduleUrl }) => {
    const { run_pack, run_pack_webgpu, vector_arithmetic_demo_pack_bytes } = await import(moduleUrl);
    const bytes = vector_arithmetic_demo_pack_bytes();
    const cpu = JSON.parse(run_pack(bytes));
    const gpu = gpuAvailable ? JSON.parse(await run_pack_webgpu(bytes)) : null;
    return { cpu, gpu };
  }, {
    gpuAvailable: selectedBackendResult.backend === "webgpu",
    moduleUrl: generatedModuleUrl,
  });
  assert.equal(vectorParity.cpu.ok, true);
  assert.deepEqual(vectorParity.cpu.values, [
    { type: "vector", elementType: "unsigned-16", values: [3, 4, 5, 6] },
    { type: "vector", elementType: "unsigned-32", values: [4294836225, 196605] },
    { type: "vector", elementType: "unsigned-16", values: [7, 2] },
    { type: "vector", elementType: "unsigned-16", values: [4, 4] },
    { type: "vector", elementType: "unsigned-16", values: [4, 10] },
    { type: "vector", elementType: "unsigned-16", values: [8, 27] },
    { type: "vector", elementType: "unsigned-16", values: [1, 2] },
    { type: "vector", elementType: "unsigned-16", values: [0, 1, 2, 3, 4] },
    { type: "vector", elementType: "unsigned-16", values: [65535, 5] },
    { type: "vector", elementType: "unsigned-16", values: [6, 8, 10, 12] },
  ]);
  if (vectorParity.gpu) {
    assert.equal(vectorParity.gpu.backend, "webgpu");
    assert.deepEqual(vectorParity.gpu.values, vectorParity.cpu.values);
  }

  const conditionalParity = await page.evaluate(async ({ gpuAvailable, moduleUrl }) => {
    const {
      conditional_number_demo_pack_bytes,
      conditional_number_alternative_demo_pack_bytes,
      run_pack,
      run_pack_webgpu,
    } = await import(moduleUrl);
    const fixtures = [
      { bytes: conditional_number_demo_pack_bytes(), expected: 7 },
      { bytes: conditional_number_alternative_demo_pack_bytes(), expected: 9 },
    ];
    const results = [];
    for (const fixture of fixtures) {
      const cpu = JSON.parse(run_pack(fixture.bytes));
      const gpu = gpuAvailable ? JSON.parse(await run_pack_webgpu(fixture.bytes)) : null;
      results.push({ cpu, gpu, expected: fixture.expected });
    }
    return results;
  }, {
    gpuAvailable: selectedBackendResult.backend === "webgpu",
    moduleUrl: generatedModuleUrl,
  });
  for (const { cpu, gpu, expected } of conditionalParity) {
    assert.equal(cpu.ok, true);
    assert.equal(cpu.values[0].value, expected);
    assert.equal(cpu.values[1].value, 2, "following codelet remains in pack order");
    if (gpu) {
      assert.equal(gpu.backend, "webgpu");
      assert.deepEqual(gpu.values, cpu.values);
    }
  }

  const fallbackContext = await browser.newContext();
  await fallbackContext.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
  });
  const fallbackPage = await fallbackContext.newPage();
  const fallbackPageErrors = [];
  fallbackPage.on("pageerror", (error) => fallbackPageErrors.push(error.message));
  await fallbackPage.goto(`http://127.0.0.1:${port}`);
  await fallbackPage.waitForFunction(() => document.querySelector("#gpu-demo").disabled === false);
  await fallbackPage.locator("#gpu-demo").click();
  await fallbackPage.waitForFunction(() => document.querySelector("#status").textContent.includes("WebGPU unavailable"));
  const fallbackResult = JSON.parse(await fallbackPage.locator("#result").textContent());
  assert.equal(fallbackResult.backend, "wasm-cpu");
  assert.deepEqual(fallbackResult.values, cpuBatch.values);
  assert.deepEqual(fallbackPageErrors, []);
  await fallbackContext.close();

  await page.locator("#pack").setInputFiles({
    name: "invalid.pyac",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a pack"),
  });
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Pack execution failed.");
  const invalidResult = JSON.parse(await page.locator("#result").textContent());
  assert.equal(invalidResult.error.code, "truncated-pack");
  assert.deepEqual(pageErrors, []);

  process.stdout.write(`browser smoke passed: WASM demo -> unsigned 2; numeric batch parity -> ${selectedBackendResult.backend}${selectedBackendResult.device ? ` (${selectedBackendResult.device})` : ""}${selectedBackendResult.backend === "wasm-cpu" ? ` (${selectedBackendStatus})` : ""}; vector arithmetic CPU${vectorParity.gpu ? "/WebGPU parity" : " fixture"}; conditional equality true/false CPU${conditionalParity[0].gpu ? "/WebGPU parity" : " fixture"}; ${programletParity.length} scalar programlet cases CPU${programletParity[0]?.gpu ? "/WebGPU parity" : " fixture"}; forced no-WebGPU -> WASM CPU fallback; malformed upload -> truncated-pack\n`);
  if (measurements.length) process.stdout.write(`warm batch benchmark (ms, median of 7 alternating samples, includes JSON result encoding): ${JSON.stringify(measurements)}\n`);
} finally {
  await browser.close();
  server.close();
}
