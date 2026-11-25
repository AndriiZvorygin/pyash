#![no_std]
#[path = "semantics_runtime/word_input.rs"]
mod word_input;
pub use word_input::VliwWord;
use word_input::input_word_unchecked;

#[cfg(test)]
extern crate std;

#[cfg_attr(not(target_arch = "spirv"), allow(dead_code))]
trait FixedArrayAccess {
    type Item: Copy;

    fn first(&self) -> Self::Item;
    fn read_at(&self, index: usize, output: &mut Self::Item) -> bool;
    fn write_at(&mut self, index: usize, value: Self::Item) -> bool;
}

impl<A: FixedArrayAccess + ?Sized> FixedArrayAccess for &A {
    type Item = A::Item;

    fn first(&self) -> Self::Item {
        (**self).first()
    }

    fn read_at(&self, index: usize, output: &mut Self::Item) -> bool {
        (**self).read_at(index, output)
    }

    fn write_at(&mut self, _index: usize, _value: Self::Item) -> bool {
        false
    }
}

impl<A: FixedArrayAccess + ?Sized> FixedArrayAccess for &mut A {
    type Item = A::Item;

    fn first(&self) -> Self::Item {
        (**self).first()
    }

    fn read_at(&self, index: usize, output: &mut Self::Item) -> bool {
        (**self).read_at(index, output)
    }

    fn write_at(&mut self, index: usize, value: Self::Item) -> bool {
        (**self).write_at(index, value)
    }
}

include!(concat!(env!("OUT_DIR"), "/fixed_array_access.rs"));

#[cfg(target_arch = "spirv")]
#[derive(Clone, Copy)]
struct FixedArrayRead<T: Copy> {
    value: T,
    valid: bool,
}

#[cfg(target_arch = "spirv")]
#[inline(always)]
fn fixed_array_read<A: FixedArrayAccess>(array: &A, index: usize) -> FixedArrayRead<A::Item> {
    let mut value = array.first();
    let valid = array.read_at(index, &mut value);
    FixedArrayRead { value, valid }
}

#[cfg(target_arch = "spirv")]
#[inline(always)]
fn fixed_array_write<A: FixedArrayAccess>(array: &mut A, index: usize, value: A::Item) -> bool {
    array.write_at(index, value)
}

include!("semantics_runtime/array_access.rs");

pub const CODELET_WORDS: usize = 16;
pub const MAX_VECTOR_LANES: usize = 16;
pub const RESULT_WORDS: usize = 32;
pub const MAX_PROGRAMLET_SECTIONS: usize = 64;
pub const MAX_PROGRAMLET_SECTION_NAME_WORDS: usize = 8;
pub const MAX_PROGRAMLET_ROUTINES: usize = 64;
/// Scratch capacity for interned identifiers and dispatch signature words.
pub const MAX_PROGRAMLET_SYMBOL_WORDS: usize = 960;
pub const MAX_PROGRAMLET_LOCAL_SLOTS: usize = 64;
pub const MAX_PROGRAMLET_CALL_DEPTH: usize = 8;
pub const MAX_PROGRAMLET_VECTOR_VALUE_WORDS: usize =
    MAX_PROGRAMLET_CALL_DEPTH * MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS * RESULT_WORDS;
const MAX_BOOLEAN_EXPRESSION_DEPTH: usize = 8;
const PROGRAMLET_EXECUTION_COMPLETE: u32 = u32::MAX;
const MAX_U16: u32 = 65_535;
const SYMBOL_NAME_SEPARATOR: u32 = MAX_U16 + 1;
pub const MAX_PROGRAMLET_ARGUMENTS: usize = 8;
const MAX_SENTENCE_FIELDS: usize = MAX_PROGRAMLET_ARGUMENTS + 2;

pub const VALUE_UNSIGNED: u32 = 1;
pub const VALUE_SIGNED: u32 = 2;
pub const VALUE_DATE: u32 = 3;
pub const VALUE_VECTOR_U16: u32 = 4;
pub const VALUE_VECTOR_U32: u32 = 5;
pub const VALUE_VECTOR_BOOL: u32 = 6;
pub const VALUE_BOOLEAN: u32 = 7;
const VALUE_NUMBER: u32 = 8;
pub const VALUE_FLOAT32: u32 = 9;
pub const VALUE_FIXED16: u32 = 10;
pub const VALUE_VECTOR_FLOAT32: u32 = 11;
pub const VALUE_VECTOR_FLOAT64: u32 = 12;
pub const VALUE_FLOAT64: u32 = 13;
const VALUE_FLOAT: u32 = 14;
const VALUE_VECTOR_FLOAT: u32 = 15;
const MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS: usize = 8;

pub const ERROR_UNSUPPORTED: u32 = 1;
pub const ERROR_DIVISION_BY_ZERO: u32 = 2;
pub const ERROR_MALFORMED: u32 = 3;
pub const ERROR_VECTOR_WIDTH: u32 = 4;
pub const ERROR_BRANCH: u32 = 5;
pub const ERROR_FRAME_CAPACITY: u32 = 6;
pub const ERROR_CONSTANT_WRITE: u32 = 7;
pub const ERROR_STEP_BUDGET: u32 = 8;
pub const ERROR_PROGRAM_CAPACITY: u32 = 9;
pub const ERROR_CALL_DEPTH: u32 = 10;
pub const ERROR_FLOAT_DOMAIN: u32 = 11;
pub const ERROR_FIXED16_DOMAIN: u32 = 12;
pub const ERROR_DUPLICATE_SIGNATURE: u32 = 13;
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramletSection {
    pub codelet_start: u32,
    pub codelet_count: u32,
    pub name_length: u32,
    pub name_words: [u32; MAX_PROGRAMLET_SECTION_NAME_WORDS],
}

impl ProgramletSection {
    pub const EMPTY: Self = Self {
        codelet_start: 0,
        codelet_count: 0,
        name_length: 0,
        name_words: [0; MAX_PROGRAMLET_SECTION_NAME_WORDS],
    };
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CoreResult {
    pub value_kind: u32,
    pub error: u32,
    pub length: u32,
    pub consumed_codelets: u32,
    pub values: [u32; RESULT_WORDS],
}

impl CoreResult {
    pub const fn empty() -> Self {
        Self {
            value_kind: 0,
            error: 0,
            length: 0,
            consumed_codelets: 0,
            values: [0; RESULT_WORDS],
        }
    }

    pub const fn failure(error: u32, consumed_codelets: u32) -> Self {
        Self {
            error,
            consumed_codelets,
            ..Self::empty()
        }
    }

    fn scalar(kind: u32, low: u32, high: u32, consumed_codelets: u32) -> Self {
        let mut result = Self::empty();
        result.value_kind = kind;
        result.length = 1;
        result.consumed_codelets = consumed_codelets;
        result.values[0] = low;
        result.values[1] = high;
        result
    }
}

const NUMBER_QUOTE: u32 = 0x881d;
const DATE_QUOTE: u32 = 0x981d;
const QUOTED_GRAMMAR: u32 = 0x229e;
const ACCUSATIVE: u32 = 0x245e;
const NOMINATIVE: u32 = 0x24de;
const SOURCE: u32 = 0x313e;
const DESTINATION: u32 = 0x243e;
const LOCATIVE: u32 = 0x615f;
const MULTIPLICATIVE: u32 = 0x6357;
const COMITATIVE: u32 = 0x490f;
const INSTRUMENTAL: u32 = 0x287e;
const DATIVE: u32 = 0x207e;
const DEONTIC: u32 = 0x295e;
const REALIS: u32 = 0x217e;
const CONDITIONAL: u32 = 0x29be;
const NUMBER_VERB: u32 = 0xea30;
const BOOLEAN_VERB: u32 = 0x7271;
const EQUALLY: u32 = 0x4809;
const TINY: u32 = 0x6c0d;
const GIANT: u32 = 0x69b3;
const NEGATORY_QUANTIFIER: u32 = 0x30de;
const AND_GRAMMAR: u32 = 0x24be;
const OR_GRAMMAR: u32 = 0x263e;
const TRUTH: u32 = 0x6909;
const LIE: u32 = 0x680d;
const DEPENDENT_CLAUSE: u32 = 0x257e;
const CLAUSE_TAIL: u32 = 0x305e;
const PLUS: u32 = 0x8a64;
const SUBTRACT: u32 = 0xabd2;
const MULTIPLY: u32 = 0xec90;
const DIVIDE: u32 = 0x8893;
const XOR: u32 = 0xa810;
const EXPONENTIAL: u32 = 0x8c29;
const REMAINS: u32 = 0xe82a;
const INVERT: u32 = 0xaad2;
const QUOTE_DENOTE: u32 = 0x001d;
const NAME_TYPE: u32 = 0x225e;
const NUMBER_TYPE: u32 = 0x327e;
const BOOLEAN_TYPE: u32 = 0x538f;
const VECTOR_TYPE: u32 = 0x2b73;
const FLOAT_TYPE: u32 = 0xaa6c;
const VARIABLE: u32 = 0xc8c4;
const PERMANENTLY: u32 = 0x0b50;
const CEREMONY: u32 = 0xe8c9;
const SECTION_MODULE: u32 = 0xec01;
const SECTION_PART: u32 = 0x6a84;
const MOOD_DEFINITION: u32 = 0x5217;
const MOOD_PARAGRAPH: u32 = 0x4e27;
const MOOD_RETURN: u32 = 0xa828;
const ESSIVE: u32 = 0x414f;
const FROM_INDEX: u32 = 0x6357;
const TO_INDEX: u32 = 0x4e4f;
const GENITIVE_CASE: u32 = 0x215e;
const THIS_WORD: u32 = 0x4a57;
pub const DEFAULT_PROGRAMLET_STEP_BUDGET: u32 = 65_536;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NumericLocalSlot {
    pub name_offset: u32,
    pub name_length: u32,
    pub value: u32,
    pub value_high: u32,
    pub kind: u32,
    pub value_kind: u32,
}

impl NumericLocalSlot {
    pub const EMPTY: Self = Self {
        name_offset: 0,
        name_length: 0,
        value: 0,
        value_high: 0,
        kind: 0,
        value_kind: 0,
    };
}

#[derive(Clone, Copy)]
struct SentenceField {
    role: u32,
    start: usize,
    length: usize,
}

impl SentenceField {
    const EMPTY: Self = Self {
        role: 0,
        start: 0,
        length: 0,
    };
}

#[derive(Clone, Copy)]
struct ParsedSentence {
    fields: [SentenceField; MAX_SENTENCE_FIELDS],
    field_count: usize,
    verb_start: usize,
    verb_length: usize,
    mood: u32,
}

impl ParsedSentence {
    const fn empty() -> Self {
        Self {
            fields: [SentenceField::EMPTY; MAX_SENTENCE_FIELDS],
            field_count: 0,
            verb_start: 0,
            verb_length: 0,
            mood: 0,
        }
    }

    fn field(&self, role: u32) -> Option<SentenceField> {
        let mut index = 0;
        while index < self.field_count {
            let fields = self.fields;
            let field = array_at!(fields, index);
            if field.role == role {
                return Some(field);
            }
            index += 1;
        }
        None
    }
}

#[derive(Clone, Copy)]
struct BooleanEvalFrame {
    start: usize,
    end: usize,
    right_start: usize,
    right_end: usize,
    state: u32,
    operator: u32,
    left_value: u32,
}

impl BooleanEvalFrame {
    const EMPTY: Self = Self {
        start: 0,
        end: 0,
        right_start: 0,
        right_end: 0,
        state: 0,
        operator: 0,
        left_value: 0,
    };
}

#[derive(Clone, Copy)]
pub(crate) struct NameSpan {
    pub(crate) start: usize,
    pub(crate) length: usize,
}

impl NameSpan {
    const EMPTY: Self = Self {
        start: 0,
        length: 0,
    };
}

#[derive(Clone, Copy)]
struct ProgramletNumber {
    bits: u32,
    high: u32,
    kind: u32,
}

impl ProgramletNumber {
    const EMPTY: Self = Self {
        bits: 0,
        high: 0,
        kind: 0,
    };
}

#[path = "semantics_runtime/boolean.rs"]
mod boolean;
#[path = "semantics_runtime/canonical_signature.rs"]
mod canonical_signature;
#[path = "semantics_runtime/conditional.rs"]
mod conditional;
#[path = "semantics_runtime/dispatch.rs"]
mod dispatch;
#[path = "semantics_runtime/embedding_lookup.rs"]
mod embedding_lookup;
#[path = "semantics_runtime/fixed16.rs"]
mod fixed16;
#[path = "semantics_runtime/float.rs"]
mod float;
#[path = "semantics_runtime/iwsp_vector_ops.rs"]
mod iwsp_vector_ops;
#[path = "semantics_runtime/mutable_vector.rs"]
mod mutable_vector;
#[path = "semantics_runtime/named_vector.rs"]
mod named_vector;
#[path = "semantics_runtime/numeric.rs"]
mod numeric;
#[path = "semantics_runtime/pluk_tlas.rs"]
mod pluk_tlas;
#[path = "semantics_runtime/programlet_actions.rs"]
mod programlet_actions;
#[path = "semantics_runtime/programlet_arguments.rs"]
mod programlet_arguments;
#[path = "semantics_runtime/programlet_branch.rs"]
mod programlet_branch;
#[path = "semantics_runtime/programlet_composition_actions.rs"]
mod programlet_composition_actions;
#[path = "semantics_runtime/programlet_dispatch_index.rs"]
mod programlet_dispatch_index;
#[path = "semantics_runtime/programlet_dispatch_signature.rs"]
mod programlet_dispatch_signature;
#[path = "semantics_runtime/programlet_embedding_lookup.rs"]
mod programlet_embedding_lookup;
#[path = "semantics_runtime/programlet_entrypoints.rs"]
mod programlet_entrypoints;
#[path = "semantics_runtime/programlet_execute.rs"]
mod programlet_execute;
#[path = "semantics_runtime/programlet_execute_call.rs"]
mod programlet_execute_call;
#[path = "semantics_runtime/programlet_execute_declare.rs"]
mod programlet_execute_declare;
#[path = "semantics_runtime/programlet_execute_paragraph.rs"]
mod programlet_execute_paragraph;
#[path = "semantics_runtime/programlet_execute_return.rs"]
mod programlet_execute_return;
#[path = "semantics_runtime/programlet_execute_setup.rs"]
mod programlet_execute_setup;
#[path = "semantics_runtime/programlet_frame.rs"]
mod programlet_frame;
#[path = "semantics_runtime/programlet_numeric_types.rs"]
mod programlet_numeric_types;
#[path = "semantics_runtime/programlet_sections.rs"]
mod programlet_sections;
#[path = "semantics_runtime/programlet_standard_deviation.rs"]
mod programlet_standard_deviation;
#[path = "semantics_runtime/programlet_symbols.rs"]
mod programlet_symbols;
#[path = "semantics_runtime/programlet_values.rs"]
mod programlet_values;
#[path = "semantics_runtime/programlet_vector_actions.rs"]
mod programlet_vector_actions;
#[path = "semantics_runtime/programlet_vector_composition.rs"]
mod programlet_vector_composition;
#[path = "semantics_runtime/programlet_vector_storage.rs"]
mod programlet_vector_storage;
#[path = "semantics_runtime/programlet_vector_values.rs"]
mod programlet_vector_values;
#[path = "semantics_runtime/scalar_product.rs"]
mod scalar_product;
#[path = "semantics_runtime/sentence.rs"]
mod sentence;
#[path = "semantics_runtime/sentence_parse_state.rs"]
mod sentence_parse_state;
#[path = "semantics_runtime/signature_dispatch.rs"]
mod signature_dispatch;
#[path = "semantics_runtime/storage_sections.rs"]
mod storage_sections;
#[path = "semantics_runtime/storage_vector.rs"]
mod storage_vector;
#[path = "semantics_runtime/storage_view.rs"]
mod storage_view;
#[path = "semantics_runtime/vector_argmax.rs"]
mod vector_argmax;
#[path = "semantics_runtime/vector_group.rs"]
mod vector_group;

use boolean::{boolean_comparison, boolean_composition, evaluate_boolean_expression_with_env};
use conditional::conditional;
pub use dispatch::{interpret_group, interpret_group_with_storage};
use float::single_codelet;
use mutable_vector::mutable_vector_declaration;
pub use numeric::apply_number_operator;
use numeric::{
    arithmetic, boolean_literal, invert, literal, number_operator, vector_arithmetic, word,
    zero_tail,
};
use programlet_actions::{apply_programlet_boolean_action, apply_programlet_number_action};
use programlet_arguments::{capture_programlet_arguments, validate_programlet_arguments};
use programlet_branch::{
    first_present_operand, programlet_branch, read_optional_programlet_number,
    unsigned_programlet_operand,
};
use programlet_composition_actions::{
    apply_programlet_composition_action, is_programlet_composition_action,
};
pub use programlet_dispatch_index::PROGRAMLET_ROUTINE_DIRECTORY_WORDS;
#[cfg(not(target_arch = "spirv"))]
pub use programlet_dispatch_index::build_programlet_routine_directory_words;
#[cfg(target_arch = "spirv")]
use programlet_dispatch_index::read_programlet_routine_directory_header;
use programlet_dispatch_index::resolve_programlet_routine;
#[cfg(not(target_arch = "spirv"))]
use programlet_dispatch_index::validate_programlet_routine_directory_words;
use programlet_embedding_lookup::{
    apply_programlet_embedding_lookup, is_programlet_embedding_lookup,
};
#[cfg(not(target_arch = "spirv"))]
pub use programlet_entrypoints::{execute_numeric_programlet, execute_numeric_programlet_at};
pub use programlet_entrypoints::{
    execute_numeric_programlet_at_with_directory_words,
    execute_numeric_programlet_at_with_directory_words_and_storage,
};
use programlet_execute_call::execute_programlet_call;
use programlet_execute_declare::declare_programlet_local;
use programlet_execute_paragraph::close_programlet_paragraph;
use programlet_execute_return::execute_programlet_return;
use programlet_execute_setup::initialize_numeric_programlet;
#[cfg(test)]
use programlet_execute_setup::last_programlet_sentence_start;
pub use programlet_frame::{
    ProgramletArgument, ProgramletFrame, ProgramletStack, ProgramletVectorSlot,
};
use programlet_frame::{
    VECTOR_SOURCE_LOCAL, VECTOR_SOURCE_QUOTE, clear_programlet_frame, frame_row,
    frame_row_is_valid, frame_row_mut, load_frame_row, store_frame_row,
};
use programlet_numeric_types::{
    compare_programlet_numbers, number_kind_matches, programlet_type_matches,
};
pub use programlet_sections::{
    has_programlet_section_header, is_numeric_programlet, is_numeric_programlet_at,
    scan_numeric_programlet_sections,
};
use programlet_symbols::{
    find_local_slot, find_local_slot_in_storage, is_ceremony_definition, names_equal, store_name,
    store_name_from_slice,
};
use programlet_values::{
    argument_value, comparison_operand, loop_iterations, optional_number_field,
    resolve_programlet_value, set_loop_index_argument, set_loop_register_argument,
    write_programlet_call_result,
};
use programlet_vector_actions::{apply_programlet_vector_action, is_programlet_vector_action};
use programlet_vector_composition::{
    apply_programlet_vector_select, declare_programlet_vector_local,
    is_programlet_vector_declaration, is_programlet_vector_select,
};
use programlet_vector_values::{
    ProgramletVectorValue, programlet_field_is_vector, programlet_vector_argument_reference,
    read_programlet_float, read_programlet_vector, write_programlet_float, write_programlet_vector,
    write_programlet_vector_result,
};
use sentence::{
    SentenceView, collect_sentence, collect_sentence_at, contains_marked_token,
    embedded_clause_range, name_span, next_sentence_is_paragraph_end, parse_sentence,
    parse_sentence_range, typed_name_span, typed_output_name,
};
pub use storage_sections::{StorageSectionRange, scan_storage_sections};
pub use storage_view::{STORAGE_BINDING_WORDS, StorageView};
#[cfg(test)]
#[path = "semantics_runtime/tests.rs"]
mod tests;
