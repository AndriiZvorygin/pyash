//! Operation signatures: what a verb accepts and returns.
//!
//! # Identity is the Pyac key, not a WordNet number
//!
//! A Pyac word is the stable identity. It can carry several references —
//! a WordNet sense, a SUMO concept, an authored gloss — and those are
//! citations, not names. WordNet sense ids are **not stable**: they move
//! between WordNet releases, and several WordNet databases are already in the
//! volume. Never treat `n:06367706-n` as the identity of a concept; treat it as
//! one reference that the current release happens to attach to a Pyac word.
//!
//! For cross-linguistic work the Pyac word is the key. Look it up by its
//! spelling, not by a sense id.
//!
//! # The dispatch identity
//!
//! ```text
//! dispatch identity = verb + mood + sorted[(grammatical_case, noun_class)]
//! ```
//!
//! `descriptive_specification` and `tag_label` are documentation. They never
//! enter the key and never affect matching; `tag_label` does take part in sort
//! order (see the ordering in `volume.rs`), so two otherwise-identical
//! signatures may be ordered by their labels, but a lookup never compares them.
//!
//! `name` is the `name_` noun class (`gi`, 0x225e). It must never be used as a
//! field name for documentation — doing so is what made readers try to put the
//! noun class into a documentation slot.
//!
//! `OperationSignatureKey` here stores the identity as `Vec<u16>` HNUCs.
//! `SignatureView` in `pyac-vliw-core`'s `canonical_signature` stores the same
//! identity packed into `u32`. They are two encodings of one thing: see
//! `pack_quote_noun_class`/`pack_word_noun_class` there before assuming they
//! differ.
//!
//! # Arguments and results are different axes
//!
//! `arguments` are the case-keyed **inputs**: each one claims a grammatical case
//! and names the noun class it accepts. They are part of the key, because the
//! caller's case words have to match.
//!
//! `results` are the **outputs**: keyed by noun class only, with no case. They
//! are not part of the key, so two signatures that differ only in what they
//! produce are the same dispatch target.
//!
//! Input versus output is the *case* axis, not the mood. Reading a mood as a
//! direction is the mistake this note exists to prevent. Today
//! `dictionary/operation_signatures.mjs` emits `results: []`, so every real
//! signature is input-only; the field is kept because the wire format and the
//! volume carry it.
//!
//! # Surface labels are vocabulary, and today they are not
//!
//! Any word the machine reads inside a pyac record should be a vocabulary entry:
//! a WordNet sense, an HNUC, and a spelling that agrees with the reference
//! volume. `label` does **not** meet that bar. The volume's argument labels are
//! the raw case tokens (`ob`, `with`, `as`, `su`), and several of them collide
//! with unrelated English words — `pyash dict from en ob` answers "obstetrics",
//! `as` answers "arsenic".
//!
//! That is tolerable only because nothing reads the label for meaning: it is
//! checked non-empty and used for sort order, never compared in a lookup or used
//! to dispatch. It is documentation that happens to be phrased in case tokens.
//! If a label ever becomes machine-meaningful, it must first become a real
//! vocabulary word.

use std::cmp::Ordering;

use super::DictionaryEntry;
use super::DictionaryIndex;

/// One argument slot: the case it occupies and the noun class it accepts.
///
/// This is the dispatch discriminator, so it is a key, not documentation. The
/// name avoids `key` because `OperationSignatureKey` is the whole-signature key,
/// and avoids `slot` because `slot` is already a vocabulary word (0xac69,
/// "shoot") — naming an identifier after a different word is the defect this
/// module exists to avoid.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ArgumentSlot {
    /// The grammatical case, WordNet `n:06321935-n`. Key `gvak`:
    /// `pyash dict from pyac gvak`.
    pub grammatical_case: Vec<u16>,
    /// The noun classes this slot accepts, as HNUC sequences. A noun class is
    /// what dispatch discriminates on; it is not a coarse scalar type.
    pub noun_class: Vec<u16>,
}

/// One case-keyed input — a `parameter`.
///
/// The identity is the compound **`parameter`**, not a sense number. Its Pyac
/// key is `tlas hrut`:
///
/// ```text
/// pyash dict from pyac "tlas hrut"      # the 1:1 entry
/// ```
///
/// The WordNet citation on that entry today is `n:06367706-n`, *"a reference or
/// value that is passed to a function, procedure, subroutine, command, or
/// program"*. Cite it as evidence; do not key on it — WordNet renumbers between
/// releases.
///
/// Use the compound, not a bare word: `pyash dict from en argument` returns eight
/// senses and `parameter` four, so only the compound names this one.
///
/// `case_type` is the contract; `tag_label` and `descriptive_specification` are
/// documentation and never take part in matching. `tag_label` does affect sort
/// order (see `volume.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationParameter {
    pub case_type: ArgumentSlot,
    /// Documentation: the compound **`tag label`**, Pyac key `tyec dlut`:
    /// `pyash dict from pyac "tyec dlut"`. WordNet citation `n:07217239-n`, *"a
    /// brief description given for purposes of identification"*.
    ///
    /// Not the `name_` noun class, and never part of the key.
    pub tag_label: String,
    /// Documentation: the compound **`descriptive specification`**, Pyac key
    /// `drut pfif`: `pyash dict from pyac "drut pfif"`. WordNet citation
    /// `n:06737512-n`, *"a statement that represents something in words"*.
    pub descriptive_specification: String,
}

/// One output, keyed by noun class only — no case, and not part of the key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationResult {
    pub noun_class: Vec<u16>,
    /// Documentation, as on `OperationParameter`.
    pub tag_label: String,
    pub descriptive_specification: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationSignature {
    pub verb: Vec<u16>,
    pub mood: Vec<u16>,
    pub arguments: Vec<OperationParameter>,
    pub results: Vec<OperationResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct OperationSignatureKey {
    verb: Vec<u16>,
    mood: Vec<u16>,
    arguments: Vec<ArgumentSlot>,
}

impl OperationSignatureKey {
    pub fn new(verb: Vec<u16>, mood: Vec<u16>, mut arguments: Vec<ArgumentSlot>) -> Self {
        arguments.sort_unstable();
        Self {
            verb,
            mood,
            arguments,
        }
    }

    pub fn verb(&self) -> &[u16] {
        &self.verb
    }

    pub fn mood(&self) -> &[u16] {
        &self.mood
    }

    pub fn arguments(&self) -> &[ArgumentSlot] {
        &self.arguments
    }
}

#[derive(Debug, Clone)]
pub(super) struct OperationPosting {
    pub(super) entry_index: usize,
    pub(super) signature_index: usize,
}

pub(super) fn validate_signature(signature: &OperationSignature) -> Option<&'static str> {
    if signature.verb.is_empty() || signature.mood.is_empty() {
        return Some("verb and mood keys must be present");
    }
    if signature.arguments.iter().any(|argument| {
        argument.case_type.grammatical_case.is_empty() || argument.case_type.noun_class.is_empty()
    }) {
        return Some("each argument must declare a case and value type");
    }
    if signature
        .arguments
        .windows(2)
        .any(|pair| pair[0].case_type.grammatical_case == pair[1].case_type.grammatical_case)
    {
        return Some("an argument case may occur only once");
    }
    if signature
        .arguments
        .iter()
        .any(|argument| argument.tag_label.trim().is_empty() || argument.descriptive_specification.trim().is_empty())
    {
        return Some("each argument needs a semantic name and description");
    }
    if signature.results.iter().any(|result| {
        result.noun_class.is_empty()
            || result.tag_label.trim().is_empty()
            || result.descriptive_specification.trim().is_empty()
    }) {
        return Some("each result needs a type, semantic name, and description");
    }
    None
}

pub(super) fn compare_signatures(
    left: &OperationSignature,
    right: &OperationSignature,
) -> Ordering {
    left.verb
        .cmp(&right.verb)
        .then(left.mood.cmp(&right.mood))
        .then_with(|| compare_arguments(&left.arguments, &right.arguments))
}

pub(super) fn compare_signature_to_key(
    signature: &OperationSignature,
    key: &OperationSignatureKey,
) -> Ordering {
    signature
        .verb
        .cmp(&key.verb)
        .then(signature.mood.cmp(&key.mood))
        .then_with(|| {
            signature
                .arguments
                .iter()
                .map(|argument| &argument.case_type)
                .cmp(key.arguments.iter())
        })
}

fn compare_arguments(left: &[OperationParameter], right: &[OperationParameter]) -> Ordering {
    left.iter()
        .map(|argument| &argument.case_type)
        .cmp(right.iter().map(|argument| &argument.case_type))
}

impl DictionaryIndex {
    /// Returns all entries matching the same structural signature, ignoring documentation labels.
    pub fn operation_signature_entries(
        &self,
        key: &OperationSignatureKey,
    ) -> impl Iterator<Item = &DictionaryEntry> {
        self.by_operation_signature(key).map(|(entry, _)| entry)
    }
}
