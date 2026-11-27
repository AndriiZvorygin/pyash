//! Vocabulary words the dictionary reader and writer share.
//!
//! Each constant is named after the English term for the word it holds, and the
//! Pya spelling sits in the doc comment. The spelling is the vocabulary's own
//! identity, but the identifier is code meant to be read in English: a field
//! called `NOMINATIVE` is no more informative than the `SU` it replaced.
//!
//! The old names were the English *role* for a Pya *case word*, which is where
//! the confusion came from: `SU` held `0x24de`, which is `na`, the nominative
//! case — not the word `su` (`0x293e`, "except_").
//!
//! The same nine constants were previously defined three times, in `wire.rs`,
//! `reader_codec.rs`, and `reader_index.rs`. Three copies of a value that must
//! agree is how this module's neighbours drifted before, so this is the single
//! source and the others import it.
//!
//! Quote headers are not vocabulary words. They are the marker words that open a
//! typed literal, and they are kept separate at the bottom so nobody reads them
//! as words to look up.

/// The name noun class (`gi`). Marks a name; never a documentation field.
pub(super) const NAME_MARKER: u16 = 0x225e;
/// Nominative case (`na`).
pub(super) const NOMINATIVE: u16 = 0x24de;
/// Accusative case (`ka`).
pub(super) const ACCUSATIVE: u16 = 0x245e;
/// Essive case (`swih`), the "as" role.
pub(super) const ESSIVE: u16 = 0x414f;
/// Source case (`so`), the "from" role.
pub(super) const SOURCE: u16 = 0x313e;
/// Destination case (`ma`), the "to" role.
pub(super) const DESTINATION: u16 = 0x243e;
/// Instrumental case (`yu`), the "by" role.
pub(super) const INSTRUMENTAL: u16 = 0x287e;
/// Comitative case (`mwah`), the "with" role.
pub(super) const COMITATIVE: u16 = 0x490f;
/// Locative case (`lwoh`), the "at" role.
pub(super) const LOCATIVE: u16 = 0x615f;
/// Realis mood (`li`).
pub(super) const REALIS: u16 = 0x217e;

/// The lexical verb "text" (`hwus`), which closes a record sentence. Distinct
/// from the text quote header below.
pub(super) const TEXT_VERB: u16 = 0x8a28;

// Quote headers. These open a typed literal in the codelet stream; they are not
// vocabulary words and must not be looked up as such.

/// Opens a uint16 literal.
pub(super) const NUMBER_QUOTE: u16 = 0x881d;
/// Opens a uint32 literal (low word, then high word).
pub(super) const UINT32_QUOTE: u16 = 0x901d;
/// Opens a text literal (length, then the bytes as words).
pub(super) const TEXT_QUOTE: u16 = 0x0e1d;
