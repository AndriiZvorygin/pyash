use super::*;

pub(super) const VECTOR_SOURCE_QUOTE: u32 = 1;
pub(super) const VECTOR_SOURCE_LOCAL: u32 = 2;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletArgument {
    pub role: u32,
    pub value: u32,
    pub value_high: u32,
    pub value_kind: u32,
    pub name_offset: u32,
    pub name_length: u32,
    pub vector_length: u32,
    pub vector_source_kind: u32,
    pub vector_source_index: u32,
    pub vector_source_frame: u32,
    pub vector_source_length: u32,
}

impl ProgramletArgument {
    pub const EMPTY: Self = Self {
        role: 0,
        value: 0,
        value_high: 0,
        value_kind: 0,
        name_offset: 0,
        name_length: 0,
        vector_length: 0,
        vector_source_kind: 0,
        vector_source_index: 0,
        vector_source_frame: 0,
        vector_source_length: 0,
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletVectorSlot {
    pub name_offset: u32,
    pub name_length: u32,
    pub value_kind: u32,
    pub length: u32,
}

impl ProgramletVectorSlot {
    pub const EMPTY: Self = Self {
        name_offset: 0,
        name_length: 0,
        value_kind: 0,
        length: 0,
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletFrame {
    pub argument_count: u32,
    pub routine_start: u32,
    pub routine_end: u32,
    pub program_counter: u32,
    pub routine_name_offset: u32,
    pub routine_name_length: u32,
    pub return_name_offset: u32,
    pub return_name_length: u32,
    pub result_value: u32,
    pub expected_kind: u32,
    pub result_kind: u32,
    pub result_length: u32,
    pub state: u32,
    pub action_started: u32,
    pub has_returned: u32,
    pub loop_active: u32,
    pub loop_remaining: u32,
    pub loop_end: u32,
    pub loop_has_end: u32,
}

impl ProgramletFrame {
    pub const EMPTY: Self = Self {
        argument_count: 0,
        routine_start: 0,
        routine_end: 0,
        program_counter: 0,
        routine_name_offset: 0,
        routine_name_length: 0,
        return_name_offset: 0,
        return_name_length: 0,
        result_value: 0,
        expected_kind: 0,
        result_kind: 0,
        result_length: 0,
        state: 0,
        action_started: 0,
        has_returned: 0,
        loop_active: 0,
        loop_remaining: 0,
        loop_end: 0,
        loop_has_end: 0,
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletStack {
    pub controls: [ProgramletFrame; MAX_PROGRAMLET_CALL_DEPTH],
    pub slots: [[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS]; MAX_PROGRAMLET_CALL_DEPTH],
    pub vector_slots:
        [ProgramletVectorSlot; MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    pub arguments: [ProgramletArgument; MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_ARGUMENTS],
    pub vector_values: [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    pub result_values: [u32; MAX_PROGRAMLET_CALL_DEPTH * RESULT_WORDS],
}

impl ProgramletStack {
    pub const EMPTY: Self = Self {
        controls: [ProgramletFrame::EMPTY; MAX_PROGRAMLET_CALL_DEPTH],
        slots: [[NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS]; MAX_PROGRAMLET_CALL_DEPTH],
        vector_slots: [ProgramletVectorSlot::EMPTY;
            MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
        arguments: [ProgramletArgument::EMPTY;
            MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_ARGUMENTS],
        vector_values: [0; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
        result_values: [0; MAX_PROGRAMLET_CALL_DEPTH * RESULT_WORDS],
    };
}

#[inline(always)]
pub(super) fn frame_row_is_valid<T, const DEPTH: usize, const WIDTH: usize>(
    backing: &[[T; WIDTH]; DEPTH],
    frame: usize,
) -> bool {
    let _ = backing;
    WIDTH != 0 && frame < DEPTH && frame < MAX_PROGRAMLET_CALL_DEPTH
}

#[inline(always)]
pub(super) fn frame_row<T: Copy, const DEPTH: usize, const WIDTH: usize>(
    backing: &[[T; WIDTH]; DEPTH],
    frame: usize,
) -> &[T; WIDTH] {
    #[cfg(target_arch = "spirv")]
    {
        unsafe {
            <[[T; WIDTH]; DEPTH] as spirv_std::arch::IndexUnchecked<[T; WIDTH]>>::index_unchecked(
                backing, frame,
            )
        }
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        &backing[frame]
    }
}

#[inline(always)]
pub(super) fn frame_row_mut<T: Copy, const DEPTH: usize, const WIDTH: usize>(
    backing: &mut [[T; WIDTH]; DEPTH],
    frame: usize,
) -> &mut [T; WIDTH] {
    #[cfg(target_arch = "spirv")]
    {
        unsafe {
            <[[T; WIDTH]; DEPTH] as spirv_std::arch::IndexUnchecked<[T; WIDTH]>>::index_unchecked_mut(
                backing, frame,
            )
        }
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        &mut backing[frame]
    }
}

#[cfg(target_arch = "spirv")]
pub(super) fn load_frame_row<T: Copy, const BACKING: usize, const WIDTH: usize>(
    backing: &[T; BACKING],
    frame: usize,
    empty: T,
) -> [T; WIDTH]
where
    [T; BACKING]: FixedArrayAccess<Item = T>,
    [T; WIDTH]: FixedArrayAccess<Item = T>,
{
    let mut row = [empty; WIDTH];
    if frame >= MAX_PROGRAMLET_CALL_DEPTH {
        return row;
    }
    let base = frame * WIDTH;
    let mut index = 0;
    while index < WIDTH {
        let value = array_at!(*backing, base + index);
        // The loop bound proves this local row index is valid without a panic branch.
        unsafe {
            *<[T; WIDTH] as spirv_std::arch::IndexUnchecked<T>>::index_unchecked_mut(
                &mut row, index,
            ) = value;
        }
        index += 1;
    }
    row
}

#[cfg(not(target_arch = "spirv"))]
pub(super) fn load_frame_row<T: Copy, const BACKING: usize, const WIDTH: usize>(
    backing: &[T; BACKING],
    frame: usize,
    empty: T,
) -> [T; WIDTH] {
    let mut row = [empty; WIDTH];
    if frame >= MAX_PROGRAMLET_CALL_DEPTH {
        return row;
    }
    let base = frame * WIDTH;
    let mut index = 0;
    while index < WIDTH {
        row[index] = backing[base + index];
        index += 1;
    }
    row
}

#[cfg(target_arch = "spirv")]
pub(super) fn store_frame_row<T: Copy, const BACKING: usize, const WIDTH: usize>(
    backing: &mut [T; BACKING],
    frame: usize,
    row: [T; WIDTH],
) where
    [T; BACKING]: FixedArrayAccess<Item = T>,
    [T; WIDTH]: FixedArrayAccess<Item = T>,
{
    if frame >= MAX_PROGRAMLET_CALL_DEPTH {
        return;
    }
    let base = frame * WIDTH;
    let mut index = 0;
    while index < WIDTH {
        let value = unsafe {
            *<[T; WIDTH] as spirv_std::arch::IndexUnchecked<T>>::index_unchecked(&row, index)
        };
        array_put!(backing, base + index, value);
        index += 1;
    }
}

#[cfg(not(target_arch = "spirv"))]
pub(super) fn store_frame_row<T: Copy, const BACKING: usize, const WIDTH: usize>(
    backing: &mut [T; BACKING],
    frame: usize,
    row: [T; WIDTH],
) {
    if frame >= MAX_PROGRAMLET_CALL_DEPTH {
        return;
    }
    let base = frame * WIDTH;
    let mut index = 0;
    while index < WIDTH {
        backing[base + index] = row[index];
        index += 1;
    }
}

pub(crate) fn clear_programlet_frame(stack: &mut ProgramletStack, index: usize) {
    array_put!(&mut stack.controls, index, ProgramletFrame::EMPTY);
    array_put!(
        &mut stack.slots,
        index,
        [NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS]
    );
    store_frame_row(
        &mut stack.vector_slots,
        index,
        [ProgramletVectorSlot::EMPTY; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    );
    store_frame_row(
        &mut stack.arguments,
        index,
        [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS],
    );
    // Vector payload is intentionally left in place; empty argument/slot descriptors make it unreachable.
    store_frame_row(&mut stack.result_values, index, [0; RESULT_WORDS]);
}
