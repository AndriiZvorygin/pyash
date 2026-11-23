import assert from "node:assert/strict";
import test from "node:test";
import { instrumentInlineSource, rewriteCargoPathDependency } from "../rust/pyac-gpu/inline_diagnostics.mjs";
import {
  createInlineMetricCollector,
  parseInlineMetrics,
  parseSpirtLocations,
  renderInlineReport,
  resolveInlineTimeoutSeconds,
} from "../rust/pyac-gpu/inline_diagnostics_report.mjs";

const inlinerFixture = `use std::mem;
pub fn inline(sess: &Session, module: &mut Module) -> super::Result<()> {
        functions_that_may_abort: module
            .functions
            .iter()
            .filter_map(|func| {
                let custom_ext_inst_set_import = custom_ext_inst_set_import?;
                func.blocks
                    .iter()
                    .any(|block| match &block.instructions[..] {
                        [.., last_normal_inst, terminator_inst]
                            if last_normal_inst.class.opcode == Op::ExtInst
                                && last_normal_inst.operands[0].unwrap_id_ref()
                                    == custom_ext_inst_set_import
                                && CustomOp::decode_from_ext_inst(last_normal_inst)
                                    == CustomOp::Abort =>
                        {
                            assert_eq!(terminator_inst.class.opcode, Op::Unreachable);
                            true
                        }

                        _ => false,
                    })
                    .then_some(func.def_id().unwrap())
            })
            .collect(),
    fn inline_fn(
        &mut self,
        function: &mut Function,
        functions: &[Result<Function, FuncIsBeingInlined>],
    ) {
        let mut block_idx = 0;
        while block_idx < function.blocks.len() {
            // If we successfully inlined a block, then repeat processing on the same block, in
            // case the newly inlined block has more inlined calls.
            // TODO: This is quadratic
            if !self.inline_block(function, block_idx, functions) {
                // TODO(eddyb) skip past the inlined callee without rescanning it.
                block_idx += 1;
            }
        }
    }
    fn inline_block(
        &mut self,
        caller: &mut Function,
        block_idx: usize,
        functions: &[Result<Function, FuncIsBeingInlined>],
    ) -> bool {
        // Find the first inlined OpFunctionCall
        let call = caller.blocks[block_idx]
                    .iter()
                    .find(|(_, inst, f)| {
                match should_inline(
                    &self.legal_globals,
                    &self.functions_that_may_abort,
                    f,
                    call_site,
                ) {
                    Ok(inline) => inline,
                    Err(MustInlineToLegalize(cause)) => {
                        if has_dont_inline(f) {
                            record(cause);
                        }
                        true
                    }
                }
            });
        let (call_index, call_inst, callee) = match call {
            None => return false,
            Some(call) => call,
        };

        // Propagate "may abort" from callee to caller (i.e. as aborts get inlined).
        true
    }

    fn add_clone_id_rules`;

const hex = (text) => Buffer.from(text).toString("hex");

test("Rust-GPU inliner patch is anchored and emits function and edge metrics", () => {
  const patched = instrumentInlineSource(inlinerFixture);
  assert.match(patched, /PYASH_INLINE_START/);
  assert.match(patched, /PYASH_INLINE_ABORT/);
  assert.match(patched, /PYASH_INLINE_FN/);
  assert.match(patched, /PYASH_INLINE_EDGE_START/);
  assert.match(patched, /PYASH_INLINE_EDGE\\t/);
  assert.doesNotMatch(patched, /pyash_inline_shape\(caller\)/);
  assert.throws(() => instrumentInlineSource("different compiler source"), /anchor/);
});

test("inline profiler rewrites a path dependency without discarding Cargo features", () => {
  const manifest = `[dependencies]\npyac-vliw-core = { path = "../../pyac-vliw-core", default-features = false }\n`;
  const rewritten = rewriteCargoPathDependency(manifest, "pyac-vliw-core", "/workspace/pyac-vliw-core");

  assert.equal(rewritten, `[dependencies]\npyac-vliw-core = { path = "/workspace/pyac-vliw-core", default-features = false }\n`);
  assert.throws(() => rewriteCargoPathDependency("[dependencies]\n", "pyac-vliw-core", "/core"), /found 0/u);
});

test("inline profiler timeout is short by default and bounded by fifteen minutes", () => {
  assert.equal(resolveInlineTimeoutSeconds(undefined), 120);
  assert.equal(resolveInlineTimeoutSeconds("90"), 90);
  assert.equal(resolveInlineTimeoutSeconds("900"), 900);
  assert.throws(() => resolveInlineTimeoutSeconds("0"), /integer from 1 to 900/u);
  assert.throws(() => resolveInlineTimeoutSeconds("901"), /integer from 1 to 900/u);
  assert.throws(() => resolveInlineTimeoutSeconds("soon"), /integer from 1 to 900/u);
});

test("inline metrics aggregate repeated edges and preserve an interrupted active edge", () => {
  const lines = [
    `PYASH_INLINE_ABORT\t${hex("pyac_vliw_core::vector::at")}`,
    `PYASH_INLINE_START\t${hex("caller")}`,
    `PYASH_INLINE_EDGE_START\t${hex("caller")}\t${hex("callee")}\t${hex("pointer legalization")}`,
    `PYASH_INLINE_EDGE\t${hex("caller")}\t${hex("callee")}\t${hex("pointer legalization")}\t12000`,
    `PYASH_INLINE_EDGE_START\t${hex("caller")}\t${hex("callee")}\t${hex("pointer legalization")}`,
    `PYASH_INLINE_EDGE\t${hex("caller")}\t${hex("callee")}\t${hex("pointer legalization")}\t8000`,
    `PYASH_INLINE_START\t${hex("slow caller")}`,
    `PYASH_INLINE_EDGE_START\t${hex("slow caller")}\t${hex("large callee")}\t${hex("inline_attribute")}`,
  ].join("\n");
  const metrics = parseInlineMetrics(lines);
  assert.equal(metrics.edgeEvents, 2);
  assert.deepEqual(metrics.abortOrigins, ["pyac_vliw_core::vector::at"]);
  assert.equal(metrics.edges.length, 1);
  assert.equal(metrics.edges[0].durationMs, 20);
  assert.equal(metrics.edges[0].count, 2);
  assert.deepEqual(metrics.activeEdge, {
    caller: "slow caller",
    callee: "large callee",
    reason: "inline_attribute",
  });
  assert.equal(metrics.activeFunction, "slow caller");
});

test("streamed metric collector and SPIR-T mapping make a compact hotspot report", () => {
  const collector = createInlineMetricCollector();
  collector.ingest(`PYASH_INLINE_ABORT\t${hex("pyac_vliw_core::vector::at")}`);
  collector.ingest(`PYASH_INLINE_START\t${hex("hot_fn")}`);
  collector.ingest(`PYASH_INLINE_FN\t${hex("hot_fn")}\t2500000\t40\t30\t2\t90\t100\t4000\t40\t0`);
  const metrics = collector.snapshot();
  assert.equal(metrics.activeFunction, null);
  const locations = parseSpirtLocations([
    "func F`hot_fn`(): void {",
    '  // spv.extinst.\"Rust-GPU\".SetDebugSrcLoc(File: "rust/pyac-vliw-core/src/execute.rs", LineStart: 42, LineEnd: 42)',
  ].join("\n"));
  const report = renderInlineReport({
    metrics,
    sourceLocations: locations,
    build: "incomplete",
    peakRssBytes: 1024 ** 3,
    stopReason: "wall limit",
  });
  assert.match(report, /hot_fn/);
  assert.match(report, /Functions Containing Rust-GPU Abort Markers/);
  assert.match(report, /pyac_vliw_core::vector::at/);
  assert.match(report, /execute\.rs:42/);
  assert.match(report, /2\.50 s/);
  assert.match(report, /wall limit/);
});
