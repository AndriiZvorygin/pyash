//! Vocabulary words the dictionary reader and writer share.
//!
//! Every constant here is a word from the accepted vocabulary, named
//! `<pya>_<english>` so the identifier carries both the spelling and the
//! meaning. The old names were the English *role* for a Pya *case word*, which
//! is where the confusion came from: `SU` was `0x24de`, which is `na`
//! ("nominative_case_"), not the word `su` (`0x293e`, "except_").
//!
//! The same nine constants were previously defined three times, in `wire.rs`,
//! `reader_codec.rs`, and `reader_index.rs`. Three copies of a value that must
//! agree is how this module's neighbours drifted before, so this is the single
//! source and the others import it.
//!
//! Quote headers are not vocabulary rows. They are the marker words that open a
//! typed literal, and they are kept separate at the bottom so nobody reads them
//! as words to look up.

/// `gi` = name_. The noun class that marks a name; never a documentation field.
pub(super) const GI_NAME: u16 = 0x225e;
/// `na` = nominative_case_.
pub(super) const NA_NOMINATIVE: u16 = 0x24de;
/// `ka` = accusative_case_.
pub(super) const KA_ACCUSATIVE: u16 = 0x245e;
/// `swih` = essive_case_.
pub(super) const SWIH_ESSIVE: u16 = 0x414f;
/// `so` = source_case_.
pub(super) const SO_SOURCE: u16 = 0x313e;
/// `ma` = destination_case_.
pub(super) const MA_DESTINATION: u16 = 0x243e;
/// `yu` = instrumental_case_.
pub(super) const YU_INSTRUMENTAL: u16 = 0x287e;
/// `mwah` = comitative_case_.
pub(super) const MWAH_COMITATIVE: u16 = 0x490f;
/// `lwoh` = locative_case_.
pub(super) const LWOH_LOCATIVE: u16 = 0x615f;
/// `li` = realis_mood_.
pub(super) const LI_REALIS: u16 = 0x217e;

/// `hwus` = text. The lexical verb "text", distinct from the text quote header.
pub(super) const HWUS_TEXT: u16 = 0x8a28;

// Quote headers. These open a typed literal in the codelet stream; they are not
// vocabulary words and must not be looked up as such.

/// Opens a uint16 literal.
pub(super) const NUMBER_QUOTE: u16 = 0x881d;
/// Opens a uint32 literal (low word, then high word).
pub(super) const UINT32_QUOTE: u16 = 0x901d;
/// Opens a text literal (length, then the bytes as words).
pub(super) const TEXT_QUOTE: u16 = 0x0e1d;
