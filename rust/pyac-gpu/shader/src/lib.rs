#![no_std]

use glam::UVec3;
use pyac_vliw_core::{
    CODELET_WORDS, CoreResult, DEFAULT_PROGRAMLET_STEP_BUDGET, ERROR_MALFORMED,
    ERROR_PROGRAM_CAPACITY, ERROR_UNSUPPORTED, MAX_PROGRAMLET_CODELETS, MAX_PROGRAMLET_LOCAL_SLOTS,
    NumericLocalSlot, PROGRAMLET_SCRATCH_WORDS, RESULT_WORDS, execute_numeric_programlet,
    interpret_group, is_numeric_programlet,
};
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

#[spirv(compute(threads(64)))]
pub fn execute_pyac_programlet(
    #[spirv(global_invocation_id)] invocation: UVec3,
    #[spirv(storage_buffer, descriptor_set = 0, binding = 0)] input: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 1)] output: &mut [u32],
) {
    if invocation.x != 0 || output.len() < RESULT_STRIDE {
        return;
    }
    let mut index = 0;
    while index < RESULT_STRIDE {
        output[index] = 0;
        index += 1;
    }

    let result = if input.len() % CODELET_WORDS != 0 {
        CoreResult::failure(ERROR_MALFORMED, 0)
    } else {
        let codelet_count = input.len() / CODELET_WORDS;
        if codelet_count > MAX_PROGRAMLET_CODELETS {
            CoreResult::failure(ERROR_PROGRAM_CAPACITY, 0)
        } else if !is_numeric_programlet(input, codelet_count) {
            CoreResult::failure(ERROR_UNSUPPORTED, 0)
        } else {
            let mut sentence_words = [0u32; PROGRAMLET_SCRATCH_WORDS];
            let mut sentence_boundaries = [0u32; PROGRAMLET_SCRATCH_WORDS];
            let mut symbol_words = [0u32; PROGRAMLET_SCRATCH_WORDS];
            let mut slots = [NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS];
            execute_numeric_programlet(
                input,
                codelet_count,
                DEFAULT_PROGRAMLET_STEP_BUDGET,
                &mut sentence_words,
                &mut sentence_boundaries,
                &mut symbol_words,
                &mut slots,
            )
        }
    };

    output[0] = result.value_kind;
    output[1] = result.error;
    output[2] = result.length;
    output[3] = result.consumed_codelets;
    index = 0;
    while index < RESULT_WORDS {
        output[4 + index] = result.values[index];
        index += 1;
    }
}
