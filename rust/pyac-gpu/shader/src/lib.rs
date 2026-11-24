#![no_std]

use glam::UVec3;
use pyac_vliw_core::{
    CODELET_WORDS, CoreResult, DEFAULT_PROGRAMLET_STEP_BUDGET, ERROR_MALFORMED,
    ERROR_PROGRAM_CAPACITY, ERROR_UNSUPPORTED, MAX_PROGRAMLET_SYMBOL_WORDS,
    PROGRAMLET_ROUTINE_DIRECTORY_WORDS, ProgramletStack,
    RESULT_WORDS, StorageView, execute_numeric_programlet_at_with_directory_words,
    interpret_group, interpret_group_with_storage, is_numeric_programlet,
};
use spirv_std::spirv;

const RESULT_STRIDE: usize = 4 + RESULT_WORDS;
#[cfg(feature = "vulkan-device-atomics")]
const SECTION_DESCRIPTOR_STRIDE: usize = 3 + pyac_vliw_core::MAX_PROGRAMLET_SECTION_NAME_WORDS;
#[cfg(feature = "vulkan-device-atomics")]
const SECTION_RESULT_STRIDE: usize =
    4 + pyac_vliw_core::MAX_PROGRAMLET_SECTION_NAME_WORDS + RESULT_STRIDE;

#[spirv(compute(threads(64)))]
pub fn execute_pyac_pack(
    #[spirv(global_invocation_id)] invocation: UVec3,
    #[spirv(storage_buffer, descriptor_set = 0, binding = 0)] input: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 1)] output: &mut [u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 5)] storage_descriptors: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 6)] storage_names: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 7)] storage_payload: &[u32],
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

    let storage = StorageView::new(storage_descriptors, storage_names, storage_payload);
    let result: CoreResult =
        interpret_group_with_storage(input, codelet_index, codelet_count, &storage);
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

#[spirv(compute(threads(1)))]
pub fn execute_pyac_programlet(
    #[spirv(global_invocation_id)] invocation: UVec3,
    #[spirv(storage_buffer, descriptor_set = 0, binding = 0)] input: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 1)] output: &mut [u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 4)] routine_directory: &[u32],
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
        if !is_numeric_programlet(input, codelet_count) {
            CoreResult::failure(ERROR_UNSUPPORTED, 0)
        } else if routine_directory.len() < PROGRAMLET_ROUTINE_DIRECTORY_WORDS {
            CoreResult::failure(ERROR_MALFORMED, 0)
        } else {
            let mut symbol_words = [0u32; MAX_PROGRAMLET_SYMBOL_WORDS];
            let mut frames = ProgramletStack::EMPTY;
            execute_numeric_programlet_at_with_directory_words(
                input,
                0,
                codelet_count,
                DEFAULT_PROGRAMLET_STEP_BUDGET,
                routine_directory,
                0,
                &mut symbol_words,
                &mut frames,
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

#[spirv(compute(threads(64)))]
#[cfg(feature = "vulkan-device-atomics")]
pub fn execute_pyac_sections(
    #[spirv(global_invocation_id)] invocation: UVec3,
    #[spirv(storage_buffer, descriptor_set = 0, binding = 0)] input: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 1)] output: &mut [u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 2)] sections: &[u32],
    #[spirv(storage_buffer, descriptor_set = 0, binding = 3)] completion_counter: &mut u32,
    #[spirv(storage_buffer, descriptor_set = 0, binding = 4)] routine_directories: &[u32],
) {
    if invocation.x % 64 != 0 || sections.len() % SECTION_DESCRIPTOR_STRIDE != 0 {
        return;
    }
    let section_index = invocation.x as usize / 64;
    let section_count = sections.len() / SECTION_DESCRIPTOR_STRIDE;
    let result_words = section_count * SECTION_RESULT_STRIDE;
    if section_index >= section_count || output.len() < result_words {
        return;
    }

    let descriptor_start = section_index * SECTION_DESCRIPTOR_STRIDE;
    let codelet_start = sections[descriptor_start] as usize;
    let codelet_count = sections[descriptor_start + 1] as usize;
    let mut result = if codelet_count == 0
        || codelet_start > input.len() / CODELET_WORDS
        || codelet_count > input.len() / CODELET_WORDS - codelet_start
    {
        CoreResult::failure(ERROR_PROGRAM_CAPACITY, 0)
    } else if !pyac_vliw_core::is_numeric_programlet_at(input, codelet_start, codelet_count) {
        CoreResult::failure(ERROR_UNSUPPORTED, 0)
    } else {
        let mut symbol_words = [0u32; MAX_PROGRAMLET_SYMBOL_WORDS];
        let mut frames = ProgramletStack::EMPTY;
        pyac_vliw_core::execute_numeric_programlet_at_with_directory_words(
            input,
            codelet_start,
            codelet_count,
            DEFAULT_PROGRAMLET_STEP_BUDGET,
            routine_directories,
            section_index * PROGRAMLET_ROUTINE_DIRECTORY_WORDS,
            &mut symbol_words,
            &mut frames,
        )
    };
    if result.consumed_codelets == 0 && result.error == 0 {
        result = CoreResult::failure(ERROR_MALFORMED, 0);
    }

    let completion_order = unsafe {
        spirv_std::arch::atomic_i_add::<
            u32,
            { spirv_std::memory::Scope::Device as u32 },
            { 0x8 | 0x40 },
        >(completion_counter, 1)
    } as usize;
    let record_start = completion_order * SECTION_RESULT_STRIDE;
    if record_start + SECTION_RESULT_STRIDE > output.len() {
        return;
    }
    output[record_start] = section_index as u32;
    output[record_start + 1] = sections[descriptor_start + 2];
    output[record_start + 2] = codelet_start as u32;
    output[record_start + 3] = codelet_count as u32;
    let mut name_index = 0usize;
    while name_index < pyac_vliw_core::MAX_PROGRAMLET_SECTION_NAME_WORDS {
        output[record_start + 4 + name_index] = sections[descriptor_start + 3 + name_index];
        name_index += 1;
    }
    let result_start = record_start + 4 + pyac_vliw_core::MAX_PROGRAMLET_SECTION_NAME_WORDS;
    output[result_start] = result.value_kind;
    output[result_start + 1] = result.error;
    output[result_start + 2] = result.length;
    output[result_start + 3] = result.consumed_codelets;
    let mut value_index = 0usize;
    while value_index < RESULT_WORDS {
        output[result_start + 4 + value_index] = result.values[value_index];
        value_index += 1;
    }
}
