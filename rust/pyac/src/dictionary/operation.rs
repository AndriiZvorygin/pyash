//! Operation signatures: what a verb accepts and returns.
//!
//! # The dispatch identity
//!
//! ```text
//! dispatch identity = verb + mood + sorted[(grammatical_case, noun_class)]
//! ```
//!
//! `description` and `label` are documentation. They never enter the key and
//! never affect matching; `label` does take part in sort order (see the ordering
//! in `volume.rs`), so two otherwise-identical signatures may be ordered by
//! their labels, but a lookup never compares them.
//!
//! `name` is the `name_` noun class (`gi`, 0x225e). It must never be used as a
//! field name for documentation — doing so is what made readers try to put the
//! noun class into a documentation slot.
//!
//! `OperationSignatureKey` here stores the identity as `Vec<u16>` HNUCs.
//! `SignatureView` in `pyac-vliw-core`'s `canonical_signature` stores the same
//! identity packed into `u32`. They are two encodings of one thing: see
//! `pack_noun_class`/`unpack_noun_class` there before assuming they differ.

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
    pub grammatical_case: Vec<u16>,
    /// The noun classes this slot accepts, as HNUC sequences. A noun class is
    /// what dispatch discriminates on; it is not a coarse scalar type.
    pub noun_class: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationArgument {
    pub case_type: ArgumentSlot,
    /// Documentation. Not the `name_` noun class, and never part of the key.
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationResult {
    pub noun_class: Vec<u16>,
    /// Documentation, as on `OperationArgument`.
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationSignature {
    pub verb: Vec<u16>,
    pub mood: Vec<u16>,
    pub arguments: Vec<OperationArgument>,
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
        .any(|argument| argument.label.trim().is_empty() || argument.description.trim().is_empty())
    {
        return Some("each argument needs a semantic name and description");
    }
    if signature.results.iter().any(|result| {
        result.noun_class.is_empty()
            || result.label.trim().is_empty()
            || result.description.trim().is_empty()
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

fn compare_arguments(left: &[OperationArgument], right: &[OperationArgument]) -> Ordering {
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
