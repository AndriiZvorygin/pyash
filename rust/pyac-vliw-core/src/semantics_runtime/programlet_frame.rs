use super::*;

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
    pub vector_values: [u32; RESULT_WORDS],
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
        vector_values: [0; RESULT_WORDS],
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletVectorSlot {
    pub name_offset: u32,
    pub name_length: u32,
    pub value_kind: u32,
    pub length: u32,
    pub values: [u32; RESULT_WORDS],
}

impl ProgramletVectorSlot {
    pub const EMPTY: Self = Self {
        name_offset: 0,
        name_length: 0,
        value_kind: 0,
        length: 0,
        values: [0; RESULT_WORDS],
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletFrame {
    pub slots: [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    pub vector_slots: [ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    pub arguments: [ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
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
    pub result_values: [u32; RESULT_WORDS],
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
        slots: [NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS],
        vector_slots: [ProgramletVectorSlot::EMPTY; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
        arguments: [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS],
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
        result_values: [0; RESULT_WORDS],
        state: 0,
        action_started: 0,
        has_returned: 0,
        loop_active: 0,
        loop_remaining: 0,
        loop_end: 0,
        loop_has_end: 0,
    };
}

pub(crate) fn clear_programlet_frame(frame: &mut ProgramletFrame) {
    let mut slot_index = 0;
    while slot_index < frame.slots.len() {
        array_put!(&mut frame.slots, slot_index, NumericLocalSlot::EMPTY);
        slot_index += 1;
    }
    let mut vector_index = 0;
    while vector_index < frame.vector_slots.len() {
        array_put!(
            &mut frame.vector_slots,
            vector_index,
            ProgramletVectorSlot::EMPTY
        );
        vector_index += 1;
    }
    frame.arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    frame.argument_count = 0;
    frame.routine_start = 0;
    frame.routine_end = 0;
    frame.program_counter = 0;
    frame.routine_name_offset = 0;
    frame.routine_name_length = 0;
    frame.return_name_offset = 0;
    frame.return_name_length = 0;
    frame.result_value = 0;
    frame.expected_kind = 0;
    frame.result_kind = 0;
    frame.result_length = 0;
    frame.result_values = [0; RESULT_WORDS];
    frame.state = 0;
    frame.action_started = 0;
    frame.has_returned = 0;
    frame.loop_active = 0;
    frame.loop_remaining = 0;
    frame.loop_end = 0;
    frame.loop_has_end = 0;
}
