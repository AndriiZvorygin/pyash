macro_rules! sentence_at {
    ($view:expr, $index:expr) => {
        ($view).token_or_first($index)
    };
}

#[cfg(target_arch = "spirv")]
macro_rules! array_at {
    ($stack:ident.slots, $frame:expr) => {
        fixed_array_read(&$stack.slots, $frame).value
    };
    ($stack:ident.vector_slots, $frame:expr) => {
        load_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS },
            MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS,
        >(&$stack.vector_slots, $frame, ProgramletVectorSlot::EMPTY)
    };
    ($stack:ident.arguments, $frame:expr) => {
        load_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_ARGUMENTS },
            MAX_PROGRAMLET_ARGUMENTS,
        >(&$stack.arguments, $frame, ProgramletArgument::EMPTY)
    };
    ($stack:ident.result_values, $frame:expr) => {
        load_frame_row::<_, { MAX_PROGRAMLET_CALL_DEPTH * RESULT_WORDS }, RESULT_WORDS>(
            &$stack.result_values,
            $frame,
            0,
        )
    };
    ($array:expr, $index:expr) => {{
        let access = fixed_array_read(&$array, $index);
        let _valid = access.valid;
        access.value
    }};
}

#[cfg(not(target_arch = "spirv"))]
macro_rules! array_at {
    ($stack:ident.slots, $frame:expr) => {
        $stack.slots[$frame]
    };
    ($stack:ident.vector_slots, $frame:expr) => {
        load_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS },
            MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS,
        >(&$stack.vector_slots, $frame, ProgramletVectorSlot::EMPTY)
    };
    ($stack:ident.arguments, $frame:expr) => {
        load_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_ARGUMENTS },
            MAX_PROGRAMLET_ARGUMENTS,
        >(&$stack.arguments, $frame, ProgramletArgument::EMPTY)
    };
    ($stack:ident.result_values, $frame:expr) => {
        load_frame_row::<_, { MAX_PROGRAMLET_CALL_DEPTH * RESULT_WORDS }, RESULT_WORDS>(
            &$stack.result_values,
            $frame,
            0,
        )
    };
    ($array:expr, $index:expr) => {
        $array[$index]
    };
}

#[cfg(target_arch = "spirv")]
macro_rules! array_put {
    (&mut $stack:ident.slots, $frame:expr, $row:expr) => {
        fixed_array_write(&mut $stack.slots, $frame, $row)
    };
    (&mut $stack:ident.vector_slots, $frame:expr, $row:expr) => {
        store_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS },
            MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS,
        >(&mut $stack.vector_slots, $frame, $row)
    };
    (&mut $stack:ident.arguments, $frame:expr, $row:expr) => {
        store_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_ARGUMENTS },
            MAX_PROGRAMLET_ARGUMENTS,
        >(&mut $stack.arguments, $frame, $row)
    };
    (&mut $stack:ident.result_values, $frame:expr, $row:expr) => {
        store_frame_row::<_, { MAX_PROGRAMLET_CALL_DEPTH * RESULT_WORDS }, RESULT_WORDS>(
            &mut $stack.result_values,
            $frame,
            $row,
        )
    };
    ($array:expr, $index:expr, $value:expr) => {{
        let _valid = fixed_array_write($array, $index, $value);
    }};
}

#[cfg(not(target_arch = "spirv"))]
macro_rules! array_put {
    (&mut $stack:ident.slots, $frame:expr, $row:expr) => {
        $stack.slots[$frame] = $row
    };
    (&mut $stack:ident.vector_slots, $frame:expr, $row:expr) => {
        store_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS },
            MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS,
        >(&mut $stack.vector_slots, $frame, $row)
    };
    (&mut $stack:ident.arguments, $frame:expr, $row:expr) => {
        store_frame_row::<
            _,
            { MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_ARGUMENTS },
            MAX_PROGRAMLET_ARGUMENTS,
        >(&mut $stack.arguments, $frame, $row)
    };
    (&mut $stack:ident.result_values, $frame:expr, $row:expr) => {
        store_frame_row::<_, { MAX_PROGRAMLET_CALL_DEPTH * RESULT_WORDS }, RESULT_WORDS>(
            &mut $stack.result_values,
            $frame,
            $row,
        )
    };
    ($array:expr, $index:expr, $value:expr) => {
        $array[$index] = $value
    };
}
