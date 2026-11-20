use std::cmp::Ordering;

use super::DictionaryEntry;
use super::DictionaryIndex;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct OperationArgumentType {
    pub grammatical_case: Vec<u16>,
    pub value_type: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationArgument {
    pub key: OperationArgumentType,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationResult {
    pub value_type: Vec<u16>,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationSignature {
    pub verb: Vec<u16>,
    pub mood: Vec<u16>,
    pub arguments: Vec<OperationArgument>,
    pub results: Vec<OperationResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationSignatureKey {
    verb: Vec<u16>,
    mood: Vec<u16>,
    arguments: Vec<OperationArgumentType>,
}

impl OperationSignatureKey {
    pub fn new(verb: Vec<u16>, mood: Vec<u16>, mut arguments: Vec<OperationArgumentType>) -> Self {
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

    pub fn arguments(&self) -> &[OperationArgumentType] {
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
        argument.key.grammatical_case.is_empty() || argument.key.value_type.is_empty()
    }) {
        return Some("each argument must declare a case and value type");
    }
    if signature
        .arguments
        .windows(2)
        .any(|pair| pair[0].key.grammatical_case == pair[1].key.grammatical_case)
    {
        return Some("an argument case may occur only once");
    }
    if signature
        .arguments
        .iter()
        .any(|argument| argument.name.trim().is_empty() || argument.description.trim().is_empty())
    {
        return Some("each argument needs a semantic name and description");
    }
    if signature.results.iter().any(|result| {
        result.value_type.is_empty()
            || result.name.trim().is_empty()
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
                .map(|argument| &argument.key)
                .cmp(key.arguments.iter())
        })
}

fn compare_arguments(left: &[OperationArgument], right: &[OperationArgument]) -> Ordering {
    left.iter()
        .map(|argument| &argument.key)
        .cmp(right.iter().map(|argument| &argument.key))
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
