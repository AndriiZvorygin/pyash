#![no_std]

use glam::UVec3;
use pyac_vliw_core::{
    CODELET_WORDS, CoreResult, RESULT_WORDS, execute_function_candidate, interpret_group,
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
pub fn evaluate_vliw_batch(
    #[spirv(global_invocation_id)] invocation: UVec3,
    #[spirv(storage_buffer, descriptor_set = 0, binding = 0)] candidates: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 1)] cases: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 2)] metadata: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 3)] output: &mut [u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 4)] scratch: &mut [u32],
) {
    let pair_index = invocation.x as usize;
    if metadata.len() < 6 {
        return;
    }
    let candidate_count = metadata[0] as usize;
    let case_count = metadata[1] as usize;
    let slot_count = metadata[2] as usize;
    let candidate_stride = metadata[3] as usize;
    let case_stride = metadata[4] as usize;
    let step_budget = metadata[5] as usize;
    let pair_count = candidate_count * case_count;
    if pair_index >= pair_count
        || case_count == 0
        || slot_count == 0
        || candidate_stride < 6
        || case_stride < slot_count
        || output.len() < pair_count * 2
        || scratch.len() < pair_count * slot_count
    {
        return;
    }

    let candidate_index = pair_index / case_count;
    let case_index = pair_index % case_count;
    let candidate_start = candidate_index * candidate_stride;
    let case_start = case_index * case_stride;
    let scratch_start = pair_index * slot_count;
    if candidate_start + candidate_stride > candidates.len()
        || case_start + case_stride > cases.len()
    {
        return;
    }
    let instruction_count = candidates[candidate_start] as usize;
    let output_slot = candidates[candidate_start + 1] as usize;
    let result = execute_function_candidate(
        candidates,
        candidate_start + 2,
        instruction_count,
        output_slot,
        cases,
        case_start,
        slot_count,
        scratch,
        scratch_start,
        step_budget,
    );
    output[pair_index * 2] = result.value;
    output[pair_index * 2 + 1] = result.error;
}
