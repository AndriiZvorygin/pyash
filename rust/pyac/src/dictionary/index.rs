use super::operation::{self, OperationPosting};
use super::{
    DictionaryEntry, DictionaryIndexError, OperationSignature, OperationSignatureKey, SourceLink,
};

#[derive(Debug, Clone)]
struct SurfacePosting {
    entry_index: usize,
    form_index: usize,
}

#[derive(Debug, Clone)]
struct SourcePosting {
    entry_index: usize,
    link_index: usize,
}

/// Read-only indexes over validated entry descriptors and their future VLIW ranges.
/// This index does not itself parse or load a dictionary image.
#[derive(Debug, Clone)]
pub struct DictionaryIndex {
    entries: Vec<DictionaryEntry>,
    surface_postings: Vec<SurfacePosting>,
    source_postings: Vec<SourcePosting>,
    operation_postings: Vec<OperationPosting>,
}

impl DictionaryIndex {
    pub fn new(
        pack_codelets: usize,
        mut entries: Vec<DictionaryEntry>,
    ) -> Result<Self, DictionaryIndexError> {
        for entry in &mut entries {
            for signature in &mut entry.operation_signatures {
                signature
                    .arguments
                    .sort_unstable_by(|left, right| left.key.cmp(&right.key));
            }
        }
        for entry in &entries {
            validate_entry(entry, pack_codelets)?;
        }
        entries.sort_unstable_by(|left, right| left.key.cmp(&right.key));
        for pair in entries.windows(2) {
            if pair[0].key == pair[1].key {
                return Err(DictionaryIndexError::DuplicateKey(pair[0].key.clone()));
            }
        }
        let mut ranges = entries
            .iter()
            .map(|entry| {
                (
                    entry.codelet_start as usize,
                    entry.codelet_start as usize + entry.codelet_count as usize,
                    entry.key.as_slice(),
                )
            })
            .collect::<Vec<_>>();
        ranges.sort_unstable_by_key(|range| range.0);
        for pair in ranges.windows(2) {
            if pair[0].1 > pair[1].0 {
                return Err(DictionaryIndexError::OverlappingCodeletRanges {
                    first_key: pair[0].2.to_vec(),
                    second_key: pair[1].2.to_vec(),
                });
            }
        }
        for entry in &entries {
            for reference in &entry.references {
                if entries
                    .binary_search_by(|candidate| candidate.key.cmp(reference))
                    .is_err()
                {
                    return Err(DictionaryIndexError::MissingReference {
                        key: entry.key.clone(),
                        reference: reference.clone(),
                    });
                }
            }
        }

        let surface_count = entries.iter().map(|entry| entry.lexical_forms.len()).sum();
        let source_count = entries.iter().map(|entry| entry.source_links.len()).sum();
        let operation_count = entries
            .iter()
            .map(|entry| entry.operation_signatures.len())
            .sum();
        let mut surface_postings = Vec::with_capacity(surface_count);
        let mut source_postings = Vec::with_capacity(source_count);
        let mut operation_postings = Vec::with_capacity(operation_count);
        for (entry_index, entry) in entries.iter().enumerate() {
            for (form_index, _) in entry.lexical_forms.iter().enumerate() {
                surface_postings.push(SurfacePosting {
                    entry_index,
                    form_index,
                });
            }
            for link_index in 0..entry.source_links.len() {
                source_postings.push(SourcePosting {
                    entry_index,
                    link_index,
                });
            }
            for signature_index in 0..entry.operation_signatures.len() {
                operation_postings.push(OperationPosting {
                    entry_index,
                    signature_index,
                });
            }
        }
        surface_postings.sort_unstable_by(|left, right| {
            let left_form = &entries[left.entry_index].lexical_forms[left.form_index];
            let right_form = &entries[right.entry_index].lexical_forms[right.form_index];
            (&left_form.language, &left_form.normalized, left.entry_index).cmp(&(
                &right_form.language,
                &right_form.normalized,
                right.entry_index,
            ))
        });
        surface_postings.dedup_by(|left, right| {
            let left_form = &entries[left.entry_index].lexical_forms[left.form_index];
            let right_form = &entries[right.entry_index].lexical_forms[right.form_index];
            left_form.language == right_form.language
                && left_form.normalized == right_form.normalized
                && left.entry_index == right.entry_index
        });
        source_postings.sort_unstable_by(|left, right| {
            let left_link = &entries[left.entry_index].source_links[left.link_index];
            let right_link = &entries[right.entry_index].source_links[right.link_index];
            (
                &left_link.dataset,
                &left_link.release,
                &left_link.identifier,
                left.entry_index,
                left.link_index,
            )
                .cmp(&(
                    &right_link.dataset,
                    &right_link.release,
                    &right_link.identifier,
                    right.entry_index,
                    right.link_index,
                ))
        });
        operation_postings.sort_unstable_by(|left, right| {
            operation::compare_signatures(
                &entries[left.entry_index].operation_signatures[left.signature_index],
                &entries[right.entry_index].operation_signatures[right.signature_index],
            )
            .then(left.entry_index.cmp(&right.entry_index))
            .then(left.signature_index.cmp(&right.signature_index))
        });

        Ok(Self {
            entries,
            surface_postings,
            source_postings,
            operation_postings,
        })
    }

    pub fn entries(&self) -> &[DictionaryEntry] {
        &self.entries
    }

    /// Bytes reserved by the sorted posting arrays, excluding entries and allocator overhead.
    pub fn posting_storage_bytes(&self) -> usize {
        self.surface_postings.capacity() * std::mem::size_of::<SurfacePosting>()
            + self.source_postings.capacity() * std::mem::size_of::<SourcePosting>()
            + self.operation_postings.capacity() * std::mem::size_of::<OperationPosting>()
    }

    pub fn by_key(&self, key: &[u16]) -> Option<&DictionaryEntry> {
        self.entries
            .binary_search_by(|entry| entry.key.as_slice().cmp(key))
            .ok()
            .map(|index| &self.entries[index])
    }

    pub fn by_surface(
        &self,
        language: &str,
        normalized: &str,
    ) -> impl Iterator<Item = &DictionaryEntry> {
        let start = self.surface_postings.partition_point(|posting| {
            let form = &self.entries[posting.entry_index].lexical_forms[posting.form_index];
            (form.language.as_str(), form.normalized.as_str()) < (language, normalized)
        });
        self.surface_postings[start..]
            .iter()
            .take_while(move |posting| {
                let form = &self.entries[posting.entry_index].lexical_forms[posting.form_index];
                form.language == language && form.normalized == normalized
            })
            .map(|posting| &self.entries[posting.entry_index])
    }

    /// Matches verb, mood, and the unordered case/type argument set.
    pub fn by_operation_signature(
        &self,
        key: &OperationSignatureKey,
    ) -> impl Iterator<Item = (&DictionaryEntry, &OperationSignature)> {
        let start = self.operation_postings.partition_point(|posting| {
            operation::compare_signature_to_key(
                &self.entries[posting.entry_index].operation_signatures[posting.signature_index],
                key,
            )
            .is_lt()
        });
        self.operation_postings[start..]
            .iter()
            .take_while(move |posting| {
                operation::compare_signature_to_key(
                    &self.entries[posting.entry_index].operation_signatures
                        [posting.signature_index],
                    key,
                )
                .is_eq()
            })
            .map(|posting| {
                (
                    &self.entries[posting.entry_index],
                    &self.entries[posting.entry_index].operation_signatures
                        [posting.signature_index],
                )
            })
    }

    pub fn by_source(
        &self,
        dataset: &str,
        release: &str,
        identifier: &str,
    ) -> impl Iterator<Item = (&DictionaryEntry, &SourceLink)> {
        let source_key = (dataset, release, identifier);
        let start = self.source_postings.partition_point(|posting| {
            let link = &self.entries[posting.entry_index].source_links[posting.link_index];
            (
                link.dataset.as_str(),
                link.release.as_str(),
                link.identifier.as_str(),
            ) < source_key
        });
        self.source_postings[start..]
            .iter()
            .take_while(move |posting| {
                let link = &self.entries[posting.entry_index].source_links[posting.link_index];
                (
                    link.dataset.as_str(),
                    link.release.as_str(),
                    link.identifier.as_str(),
                ) == source_key
            })
            .map(|posting| {
                (
                    &self.entries[posting.entry_index],
                    &self.entries[posting.entry_index].source_links[posting.link_index],
                )
            })
    }

    /// Selects language/task entries and includes all referenced entries transitively.
    pub fn project(
        &self,
        language: Option<&str>,
        task_key: Option<&[u16]>,
    ) -> Vec<&DictionaryEntry> {
        let mut included = vec![false; self.entries.len()];
        let mut pending = Vec::new();
        for (index, entry) in self.entries.iter().enumerate() {
            let has_language = language.is_none_or(|language| {
                entry
                    .lexical_forms
                    .iter()
                    .any(|form| form.language == language)
            });
            let has_task = task_key.is_none_or(|key| {
                entry
                    .task_keys
                    .iter()
                    .any(|candidate| candidate.as_slice() == key)
            });
            if has_language && has_task {
                included[index] = true;
                pending.push(index);
            }
        }
        while let Some(index) = pending.pop() {
            for key in &self.entries[index].references {
                let referenced = self
                    .entries
                    .binary_search_by(|entry| entry.key.cmp(key))
                    .expect("references were validated when the index was built");
                if !included[referenced] {
                    included[referenced] = true;
                    pending.push(referenced);
                }
            }
        }
        self.entries
            .iter()
            .zip(included)
            .filter_map(|(entry, include)| include.then_some(entry))
            .collect()
    }
}

fn validate_entry(
    entry: &DictionaryEntry,
    pack_codelets: usize,
) -> Result<(), DictionaryIndexError> {
    if entry.key.is_empty() {
        return Err(DictionaryIndexError::EmptyKey);
    }
    for signature in &entry.operation_signatures {
        if let Some(reason) = operation::validate_signature(signature) {
            return Err(DictionaryIndexError::InvalidOperationSignature {
                key: entry.key.clone(),
                reason,
            });
        }
    }
    let start = entry.codelet_start as usize;
    let count = entry.codelet_count as usize;
    if count == 0
        || start
            .checked_add(count)
            .is_none_or(|end| end > pack_codelets)
    {
        return Err(DictionaryIndexError::InvalidCodeletRange {
            key: entry.key.clone(),
            start: entry.codelet_start,
            count: entry.codelet_count,
            pack_codelets,
        });
    }
    for form in &entry.lexical_forms {
        for (field, value) in [
            ("language", form.language.as_str()),
            ("surface", form.surface.as_str()),
            ("normalized form", form.normalized.as_str()),
        ] {
            if value.is_empty() {
                return Err(DictionaryIndexError::EmptyLexicalField {
                    key: entry.key.clone(),
                    field,
                });
            }
        }
    }
    for link in &entry.source_links {
        for (field, value) in [
            ("dataset", link.dataset.as_str()),
            ("release", link.release.as_str()),
            ("identifier", link.identifier.as_str()),
            ("relation", link.relation.as_str()),
        ] {
            if value.is_empty() {
                return Err(DictionaryIndexError::EmptySourceField {
                    key: entry.key.clone(),
                    field,
                });
            }
        }
    }
    Ok(())
}
