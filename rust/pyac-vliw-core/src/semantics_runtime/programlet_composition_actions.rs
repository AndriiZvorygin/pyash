use super::programlet_standard_deviation::{
    apply_programlet_standard_deviation, is_programlet_standard_deviation,
};
use super::programlet_vector_composition::{
    apply_programlet_dot_product_store, is_programlet_dot_product_store,
};
use super::*;

pub(super) fn is_programlet_composition_action(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
) -> bool {
    is_programlet_dot_product_store(sentence, tokens)
        || is_programlet_standard_deviation(sentence, tokens)
}

pub(super) fn apply_programlet_composition_action(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
    symbols: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    symbol_used: &mut usize,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    frame_index: usize,
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    vector_slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
) -> Result<(), u32> {
    if is_programlet_dot_product_store(sentence, tokens) {
        apply_programlet_dot_product_store(
            sentence,
            tokens,
            symbols,
            symbol_used,
            arguments,
            frame_index,
            slots,
            vector_slots,
            vector_values,
        )
    } else {
        apply_programlet_standard_deviation(
            sentence,
            tokens,
            symbols,
            symbol_used,
            arguments,
            slots,
        )
    }
}
