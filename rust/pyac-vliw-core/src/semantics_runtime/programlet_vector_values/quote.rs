use super::*;

macro_rules! write_float32_lane {
    ($tokens:ident, $start:ident, $cursor:ident, $length:ident, $value:ident, $lane:literal) => {
        if $length > $lane {
            let lane_cursor = $cursor + $lane * 2;
            let low = $tokens.word_at_word_index($start, lane_cursor)
                | ($tokens.word_at_word_index($start, lane_cursor + 1) << 16);
            if low & 0x7f80_0000 == 0x7f80_0000 {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            array_put!(&mut $value.values, $lane, low);
        }
    };
}

macro_rules! write_float64_lane {
    ($tokens:ident, $start:ident, $cursor:ident, $length:ident, $value:ident, $lane:literal, $low_slot:literal, $high_slot:literal) => {
        if $length > $lane {
            let lane_cursor = $cursor + $lane * 4;
            let low = $tokens.word_at_word_index($start, lane_cursor)
                | ($tokens.word_at_word_index($start, lane_cursor + 1) << 16);
            let high = $tokens.word_at_word_index($start, lane_cursor + 2)
                | ($tokens.word_at_word_index($start, lane_cursor + 3) << 16);
            if high & 0x7ff0_0000 == 0x7ff0_0000 {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            array_put!(&mut $value.values, $low_slot, low);
            array_put!(&mut $value.values, $high_slot, high);
        }
    };
}

pub(super) fn vector_from_quote(
    tokens: &SentenceView<'_, impl VliwWord>,
    start_word_index: usize,
    token_count: usize,
) -> Result<ProgramletVectorValue, u32> {
    if !tokens.word_span_is_valid(start_word_index, token_count) {
        return Err(ERROR_MALFORMED);
    }
    let header_word = tokens.word_at_word_index(start_word_index, 0);
    let header = quote_header(header_word);
    if header.valid == 0 || header.sort != 6 || !matches!(header.scalar_bytes, 4 | 8) {
        return Err(ERROR_UNSUPPORTED);
    }
    if header_word & 0x0700 == 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    let mut cursor = 1;
    let end = token_count;
    let words_per_lane = header.scalar_bytes as usize / 2;
    if words_per_lane == 0 {
        return Err(ERROR_MALFORMED);
    }
    let length = if header.explicit != 0 {
        if cursor >= end {
            return Err(ERROR_MALFORMED);
        }
        let length = tokens.word_at_word_index(start_word_index, cursor) as usize;
        cursor += 1;
        length
    } else {
        header
            .fixed_length
            .checked_div(words_per_lane as u32)
            .ok_or(ERROR_MALFORMED)? as usize
    };
    if length == 0 || length > MAX_VECTOR_LANES || cursor + length * words_per_lane != end {
        return Err(ERROR_VECTOR_WIDTH);
    }

    let kind = if header.scalar_bytes == 4 {
        VALUE_VECTOR_FLOAT32
    } else {
        VALUE_VECTOR_FLOAT64
    };
    let mut value = ProgramletVectorValue {
        kind,
        length,
        ..ProgramletVectorValue::EMPTY
    };
    if kind == VALUE_VECTOR_FLOAT32 {
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 0);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 1);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 2);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 3);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 4);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 5);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 6);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 7);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 8);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 9);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 10);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 11);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 12);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 13);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 14);
        write_float32_lane!(tokens, start_word_index, cursor, length, value, 15);
    } else {
        #[cfg(not(feature = "shader-f64"))]
        return Err(ERROR_UNSUPPORTED);
        #[cfg(feature = "shader-f64")]
        {
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 0, 0, 1);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 1, 2, 3);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 2, 4, 5);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 3, 6, 7);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 4, 8, 9);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 5, 10, 11);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 6, 12, 13);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 7, 14, 15);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 8, 16, 17);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 9, 18, 19);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 10, 20, 21);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 11, 22, 23);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 12, 24, 25);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 13, 26, 27);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 14, 28, 29);
            write_float64_lane!(tokens, start_word_index, cursor, length, value, 15, 30, 31);
        }
    }
    Ok(value)
}
