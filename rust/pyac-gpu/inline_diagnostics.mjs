const METRIC_HELPERS = `
fn pyash_inline_hex(value: &str) -> String {
    value.as_bytes().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn pyash_inline_shape(function: &Function) -> (usize, usize, usize, usize) {
    let blocks = function.blocks.len();
    let mut instructions = 0;
    let mut calls = 0;
    for inst in function.all_inst_iter() {
        instructions += 1;
        if inst.class.opcode == Op::FunctionCall {
            calls += 1;
        }
    }
    (blocks, instructions, calls, function.parameters.len())
}
`;

function replaceExactly(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Rust-GPU instrumentation anchor ${label}: expected once, found ${count}`);
  return source.replace(before, after);
}

export function instrumentInlineSource(source) {
  let patched = source;
  patched = replaceExactly(patched, "use std::mem;", "use std::mem;\nuse std::time::Instant;", "time import");
  patched = replaceExactly(patched, "pub fn inline(sess: &Session, module: &mut Module) -> super::Result<()> {", `${METRIC_HELPERS}\npub fn inline(sess: &Session, module: &mut Module) -> super::Result<()> {`, "metric helpers");

  const inlineFnBefore = `    fn inline_fn(
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
    }`;
  const inlineFnAfter = `    fn inline_fn(
        &mut self,
        function: &mut Function,
        functions: &[Result<Function, FuncIsBeingInlined>],
    ) {
        let function_id = function.def_id().unwrap();
        let function_name = self.id_to_name.get(&function_id).copied().unwrap_or("<unnamed>").to_owned();
        let (blocks_before, instructions_before, calls_before, _) = pyash_inline_shape(function);
        let mut block_scans = 0usize;
        let mut successful_inlines = 0usize;
        eprintln!("PYASH_INLINE_START\\t{}", pyash_inline_hex(&function_name));
        let started = Instant::now();

        let mut block_idx = 0;
        while block_idx < function.blocks.len() {
            block_scans += 1;
            if self.inline_block(function, block_idx, functions) {
                successful_inlines += 1;
            } else {
                block_idx += 1;
            }
        }

        let elapsed_micros = started.elapsed().as_micros();
        let (blocks_after, instructions_after, calls_after, _) = pyash_inline_shape(function);
        eprintln!(
            "PYASH_INLINE_FN\\t{}\\t{}\\t{}\\t{}\\t{}\\t{}\\t{}\\t{}\\t{}\\t{}",
            pyash_inline_hex(&function_name),
            elapsed_micros,
            block_scans,
            successful_inlines,
            blocks_before,
            blocks_after,
            instructions_before,
            instructions_after,
            calls_before,
            calls_after,
        );
    }`;
  patched = replaceExactly(patched, inlineFnBefore, inlineFnAfter, "per-function inline loop");

  patched = replaceExactly(
    patched,
    "        // Find the first inlined OpFunctionCall\n        let call = caller.blocks[block_idx]",
    "        // Find the first inlined OpFunctionCall\n        let mut inline_reason = None;\n        let call = caller.blocks[block_idx]",
    "inline reason capture",
  );
  patched = replaceExactly(
    patched,
    `                    Ok(inline) => inline,
                    Err(MustInlineToLegalize(cause)) => {
                        if has_dont_inline(f) {`,
    `                    Ok(inline) => {
                        if inline { inline_reason = Some("inline_attribute"); }
                        inline
                    }
                    Err(MustInlineToLegalize(cause)) => {
                        inline_reason = Some(cause);
                        if has_dont_inline(f) {`,
    "inline reason branches",
  );

  patched = replaceExactly(
    patched,
    `        let (call_index, call_inst, callee) = match call {
            None => return false,
            Some(call) => call,
        };

        // Propagate "may abort" from callee to caller (i.e. as aborts get inlined).`,
    `        let (call_index, call_inst, callee) = match call {
            None => return false,
            Some(call) => call,
        };
        let caller_id = caller.def_id().unwrap();
        let callee_id = callee.def_id().unwrap();
        let caller_name = self.id_to_name.get(&caller_id).copied().unwrap_or("<unnamed>").to_owned();
        let callee_name = self.id_to_name.get(&callee_id).copied().unwrap_or("<unnamed>").to_owned();
        let reason = inline_reason.unwrap_or("unknown");
        eprintln!("PYASH_INLINE_EDGE_START\\t{}\\t{}\\t{}", pyash_inline_hex(&caller_name), pyash_inline_hex(&callee_name), pyash_inline_hex(reason));
        let edge_started = Instant::now();

        // Propagate "may abort" from callee to caller (i.e. as aborts get inlined).`,
    "per-edge inline timing start",
  );

  patched = replaceExactly(
    patched,
    `        true
    }

    fn add_clone_id_rules`,
    `        let elapsed_micros = edge_started.elapsed().as_micros();
        eprintln!(
            "PYASH_INLINE_EDGE\\t{}\\t{}\\t{}\\t{}",
            pyash_inline_hex(&caller_name),
            pyash_inline_hex(&callee_name),
            pyash_inline_hex(reason),
            elapsed_micros,
        );
        true
    }

    fn add_clone_id_rules`,
    "per-edge inline timing end",
  );
  return patched;
}
