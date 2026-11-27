#![no_std]
#![feature(abi_ptx, stdarch_nvptx)]

use core::arch::nvptx::{_block_dim_x, _block_idx_x, _thread_idx_x, trap};
use core::slice::{from_raw_parts, from_raw_parts_mut};
use core::sync::atomic::{AtomicU32, Ordering};
use pyac_vliw_core::{
    CODELET_WORDS, CoreResult, DEFAULT_PROGRAMLET_STEP_BUDGET, ERROR_MALFORMED,
    MAX_PROGRAMLET_SECTION_NAME_WORDS, MAX_PROGRAMLET_SECTIONS, MAX_PROGRAMLET_SYMBOL_WORDS,
    PROGRAMLET_ROUTINE_DIRECTORY_WORDS, ProgramletStack, RESULT_WORDS, StorageView,
    execute_numeric_programlet_at_with_directory_words_and_storage, interpret_group_with_storage,
};

const RESULT_STRIDE: usize = 4 + RESULT_WORDS;
const SECTION_HEADER: usize = 4 + MAX_PROGRAMLET_SECTION_NAME_WORDS;
const SECTION_RESULT_STRIDE: usize = SECTION_HEADER + RESULT_STRIDE;
const SECTION_DESCRIPTOR_STRIDE: usize = 3 + MAX_PROGRAMLET_SECTION_NAME_WORDS;

struct FrameStorage {
    symbols: [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    stack: ProgramletStack,
}

impl FrameStorage {
    const EMPTY: Self = Self {
        symbols: [0; MAX_PROGRAMLET_SYMBOL_WORDS],
        stack: ProgramletStack::EMPTY,
    };
}

// The resident worker serializes launches. Each section owns a different slot.
static mut FRAMES: [FrameStorage; MAX_PROGRAMLET_SECTIONS] =
    [const { FrameStorage::EMPTY }; MAX_PROGRAMLET_SECTIONS];

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    unsafe { trap() }
}

fn write_result(result: CoreResult, words: &mut [u32]) {
    words[0] = result.value_kind;
    words[1] = result.error;
    words[2] = result.length;
    words[3] = result.consumed_codelets;
    words[4..].copy_from_slice(&result.values);
}

unsafe fn run_programlet(
    input: &[u16],
    start: usize,
    count: usize,
    directory: &[u32],
    slot: usize,
    storage: &StorageView<'_>,
) -> CoreResult {
    let frame = unsafe { &mut *(&raw mut FRAMES).cast::<FrameStorage>().add(slot) };
    *frame = FrameStorage::EMPTY;
    execute_numeric_programlet_at_with_directory_words_and_storage(
        input,
        start,
        count,
        DEFAULT_PROGRAMLET_STEP_BUDGET,
        directory,
        slot * PROGRAMLET_ROUTINE_DIRECTORY_WORDS,
        storage,
        &mut frame.symbols,
        &mut frame.stack,
    )
}

#[unsafe(no_mangle)]
pub unsafe extern "ptx-kernel" fn execute_pyac_pack(
    input: *const u16,
    codelet_count: u32,
    output: *mut u32,
    storage_descriptors: *const u32,
    storage_descriptor_words: u32,
    storage_names: *const u32,
    storage_name_count: u32,
    storage_payload: *const u32,
    storage_payload_words: u32,
) {
    let index = unsafe { _block_idx_x() * _block_dim_x() + _thread_idx_x() } as usize;
    let count = codelet_count as usize;
    if index >= count {
        return;
    }
    let input = unsafe { from_raw_parts(input, count * CODELET_WORDS) };
    let descriptors =
        unsafe { from_raw_parts(storage_descriptors, storage_descriptor_words as usize) };
    let names = unsafe { from_raw_parts(storage_names, storage_name_count as usize) };
    let payload = unsafe { from_raw_parts(storage_payload, storage_payload_words as usize) };
    let storage = StorageView::new(descriptors, names, payload);
    if index > 0 && input[(index - 1) * CODELET_WORDS] & 1 == 0 {
        return;
    }
    let result = interpret_group_with_storage(input, index, count, &storage);
    let words = unsafe { from_raw_parts_mut(output.add(index * RESULT_STRIDE), RESULT_STRIDE) };
    write_result(result, words);
}

#[unsafe(no_mangle)]
pub unsafe extern "ptx-kernel" fn execute_pyac_programlet(
    input: *const u16,
    codelet_count: u32,
    output: *mut u32,
    directory: *const u32,
    storage_descriptors: *const u32,
    storage_descriptor_words: u32,
    storage_names: *const u32,
    storage_name_count: u32,
    storage_payload: *const u32,
    storage_payload_words: u32,
) {
    if unsafe { _block_idx_x() != 0 || _thread_idx_x() != 0 } {
        return;
    }
    let count = codelet_count as usize;
    let input = unsafe { from_raw_parts(input, count * CODELET_WORDS) };
    let directory = unsafe { from_raw_parts(directory, PROGRAMLET_ROUTINE_DIRECTORY_WORDS) };
    let descriptors =
        unsafe { from_raw_parts(storage_descriptors, storage_descriptor_words as usize) };
    let names = unsafe { from_raw_parts(storage_names, storage_name_count as usize) };
    let payload = unsafe { from_raw_parts(storage_payload, storage_payload_words as usize) };
    let storage = StorageView::new(descriptors, names, payload);
    let result = unsafe { run_programlet(input, 0, count, directory, 0, &storage) };
    write_result(result, unsafe { from_raw_parts_mut(output, RESULT_STRIDE) });
}

#[unsafe(no_mangle)]
pub unsafe extern "ptx-kernel" fn execute_pyac_sections(
    input: *const u16,
    codelet_count: u32,
    output: *mut u32,
    descriptors: *const u32,
    section_count: u32,
    completion: *mut AtomicU32,
    directories: *const u32,
    storage_descriptors: *const u32,
    storage_descriptor_words: u32,
    storage_names: *const u32,
    storage_name_count: u32,
    storage_payload: *const u32,
    storage_payload_words: u32,
) {
    let section = unsafe { _block_idx_x() } as usize;
    let section_count = section_count as usize;
    if unsafe { _thread_idx_x() } != 0
        || section >= section_count
        || section_count > MAX_PROGRAMLET_SECTIONS
    {
        return;
    }
    let input = unsafe { from_raw_parts(input, codelet_count as usize * CODELET_WORDS) };
    let descriptor = unsafe {
        from_raw_parts(
            descriptors.add(section * SECTION_DESCRIPTOR_STRIDE),
            SECTION_DESCRIPTOR_STRIDE,
        )
    };
    let directories = unsafe {
        from_raw_parts(
            directories,
            PROGRAMLET_ROUTINE_DIRECTORY_WORDS * section_count,
        )
    };
    let storage_descriptors =
        unsafe { from_raw_parts(storage_descriptors, storage_descriptor_words as usize) };
    let storage_names = unsafe { from_raw_parts(storage_names, storage_name_count as usize) };
    let storage_payload =
        unsafe { from_raw_parts(storage_payload, storage_payload_words as usize) };
    let storage = StorageView::new(storage_descriptors, storage_names, storage_payload);
    let mut result = unsafe {
        run_programlet(
            input,
            descriptor[0] as usize,
            descriptor[1] as usize,
            directories,
            section,
            &storage,
        )
    };
    if result.consumed_codelets == 0 && result.error == 0 {
        result = CoreResult::failure(ERROR_MALFORMED, 0);
    }
    let ticket = unsafe { &*completion }.fetch_add(1, Ordering::Relaxed) as usize;
    if ticket >= section_count {
        return;
    }
    let record = unsafe {
        from_raw_parts_mut(
            output.add(ticket * SECTION_RESULT_STRIDE),
            SECTION_RESULT_STRIDE,
        )
    };
    record[0] = section as u32;
    record[1] = descriptor[2];
    record[2] = descriptor[0];
    record[3] = descriptor[1];
    record[4..SECTION_HEADER].copy_from_slice(&descriptor[3..]);
    write_result(result, &mut record[SECTION_HEADER..]);
}
