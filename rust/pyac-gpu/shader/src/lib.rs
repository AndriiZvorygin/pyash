#![no_std]

use glam::UVec3;
use pyac_vliw_core::{CODELET_WORDS, CoreResult, RESULT_WORDS, interpret_group};
use spirv_std::spirv;

const RESULT_STRIDE: usize = 4 + RESULT_WORDS;

#[spirv(compute(threads(64)))]
pub fn execute_pyac_pack(
    #[spirv(global_invocation_id)] invocation: UVec3,
    #[spirv(storage_buffer, descriptor_set = 0, binding = 0)] input: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 1)] output: &mut [u32],
) {
    let codelet_count = input.len() / CODELET_WORDS;
    let codelet_index = invocation.x as usize;
    if codelet_index >= codelet_count || output.len() < codelet_count * RESULT_STRIDE {
        return;
    }

    let output_start = codelet_index * RESULT_STRIDE;
    let mut word_index = 0;
    while word_index < RESULT_STRIDE {
        output[output_start + word_index] = 0;
        word_index += 1;
    }

    if codelet_index > 0 {
        let previous_head = input[(codelet_index - 1) * CODELET_WORDS];
        if previous_head & 1 == 0 {
            return;
        }
    }

    let result: CoreResult = interpret_group(input, codelet_index, codelet_count);
    output[output_start] = result.value_kind;
    output[output_start + 1] = result.error;
    output[output_start + 2] = result.length;
    output[output_start + 3] = result.consumed_codelets;
    word_index = 0;
    while word_index < RESULT_WORDS {
        output[output_start + 4 + word_index] = result.values[word_index];
        word_index += 1;
    }
}
