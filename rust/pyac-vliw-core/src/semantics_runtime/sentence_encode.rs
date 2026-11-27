//! Sentence encoding: the structural inverse of `parse_sentence`.
//!
//! PyAC is the spoken form of the VLIW layout, not a separate grammar. The
//! decoder walks a codelet group, closes a field when it meets a case word, and
//! closes the verb when it meets a mood at the end. So encoding is just that
//! shape emitted in order:
//!
//! ```text
//! <value words> <case word>   for each field, in order
//! <verb words>  <mood word>   once, last
//! ```
//!
//! No table: the case and mood words are the same constants the decoder tests.
//! No buffer either: [`SentenceWords`] yields one word at a time, and
//! [`Codelets`] groups that stream into codelets with the boundary bits the
//! decoder reads. Nothing is collected.

use super::*;

/// One field: the case word that closes it, and the value words before it.
#[derive(Clone, Copy)]
pub struct EncodeField<'a> {
    /// The case word, e.g. `NOMINATIVE` (`na`) or `ACCUSATIVE` (`ka`).
    pub case: u32,
    /// The value words, in order. Must be non-empty.
    pub value: &'a [u32],
}

/// A sentence to encode.
#[derive(Clone, Copy)]
pub struct EncodeSentence<'a> {
    /// Fields in the order they should appear.
    pub fields: &'a [EncodeField<'a>],
    /// The verb words. May be empty only for a return mood, matching a decoder rule.
    pub verb: &'a [u32],
    /// The mood word that terminates the sentence.
    pub mood: u32,
}

/// Why an encode request was rejected.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncodeError {
    /// More fields than the decoder can hold.
    TooManyFields,
    /// A field had no value words, or a field repeated a case role.
    MalformedField,
    /// The verb was empty for a mood that requires one, or present for one that does not.
    MalformedVerb,
    /// No mood, or a word the decoder would not accept as a mood.
    MissingMood,
}

/// Whether `case` is a role the decoder accepts as a field boundary.
///
/// Mirrors `FieldBuilder::accept_boundary`; if that list grows, this must too.
pub const fn is_field_case(case: u32) -> bool {
    matches!(
        case,
        NOMINATIVE
            | ACCUSATIVE
            | ESSIVE
            | DESTINATION
            | SOURCE
            | COMITATIVE
            | INSTRUMENTAL
            | FROM_INDEX
            | TO_INDEX
            | LOCATIVE
    )
}

/// Whether `mood` is a mood the decoder accepts as a sentence terminator.
pub const fn is_sentence_mood(mood: u32) -> bool {
    matches!(
        mood,
        MOOD_DEFINITION | REALIS | DEONTIC | CONDITIONAL | MOOD_RETURN | MOOD_PARAGRAPH
    )
}

const fn case_bit(case: u32) -> u32 {
    match case {
        NOMINATIVE => 1 << 0,
        ACCUSATIVE => 1 << 1,
        ESSIVE => 1 << 2,
        DESTINATION => 1 << 3,
        SOURCE => 1 << 4,
        COMITATIVE => 1 << 5,
        INSTRUMENTAL => 1 << 6,
        FROM_INDEX => 1 << 7,
        TO_INDEX => 1 << 8,
        LOCATIVE => 1 << 9,
        _ => 0,
    }
}

/// Validate a sentence before streaming it, so a bad request fails once up front.
pub fn validate(sentence: &EncodeSentence<'_>) -> Result<(), EncodeError> {
    if !is_sentence_mood(sentence.mood) {
        return Err(EncodeError::MissingMood);
    }
    if sentence.fields.len() > MAX_SENTENCE_FIELDS {
        return Err(EncodeError::TooManyFields);
    }
    // The decoder rejects a return mood carrying a verb, and any other mood
    // without one, so a request that breaks that rule can never decode.
    let verb_required = sentence.mood != MOOD_RETURN;
    if verb_required == sentence.verb.is_empty() {
        return Err(EncodeError::MalformedVerb);
    }
    let mut seen_cases: u32 = 0;
    for field in sentence.fields {
        if !is_field_case(field.case) || field.value.is_empty() {
            return Err(EncodeError::MalformedField);
        }
        let bit = case_bit(field.case);
        if seen_cases & bit != 0 {
            return Err(EncodeError::MalformedField);
        }
        seen_cases |= bit;
    }
    Ok(())
}

/// One word, and whether it closes a case (or, for the mood, the sentence).
///
/// This is exactly what the decoder reads: a boundary flag and a word.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EncodedWord {
    pub word: u32,
    pub boundary_after: bool,
}

/// Streams a sentence's words in decoder order. No allocation, no buffering.
pub struct SentenceWords<'a> {
    sentence: &'a EncodeSentence<'a>,
    field_index: usize,
    value_index: usize,
    verb_index: usize,
    mood_emitted: bool,
}

impl<'a> SentenceWords<'a> {
    /// Start streaming `sentence`. Call [`validate`] first to reject bad input.
    pub const fn new(sentence: &'a EncodeSentence<'a>) -> Self {
        Self {
            sentence,
            field_index: 0,
            value_index: 0,
            verb_index: 0,
            mood_emitted: false,
        }
    }
}

impl Iterator for SentenceWords<'_> {
    type Item = EncodedWord;

    fn next(&mut self) -> Option<EncodedWord> {
        // Fields: value words first, then the case word that closes them.
        while self.field_index < self.sentence.fields.len() {
            let field = self.sentence.fields[self.field_index];
            let word = match field.value.get(self.value_index) {
                Some(word) => *word,
                // Past the value: emit the case word with its boundary mark.
                None => {
                    self.field_index += 1;
                    self.value_index = 0;
                    return Some(EncodedWord {
                        word: field.case,
                        boundary_after: true,
                    });
                }
            };
            self.value_index += 1;
            return Some(EncodedWord {
                word,
                boundary_after: false,
            });
        }
        // Verb words, then the mood that closes both verb and sentence.
        if let Some(word) = self.sentence.verb.get(self.verb_index) {
            self.verb_index += 1;
            return Some(EncodedWord {
                word: *word,
                boundary_after: false,
            });
        }
        if !self.mood_emitted {
            self.mood_emitted = true;
            return Some(EncodedWord {
                word: self.sentence.mood,
                boundary_after: true,
            });
        }
        None
    }
}

/// Groups a [`SentenceWords`] stream into codelets, setting the head bitmap.
///
/// The decoder reads a slot as a boundary when
/// `(head & (1 << slot) != 0) == (head & 1 != 0)`. Because that polarity flips
/// for the final codelet, one codelet of lookahead is unavoidable — that is 16
/// words of state, not a copy of the sentence.
pub struct Codelets<'a> {
    words: SentenceWords<'a>,
    pending: [u32; CODELET_WORDS],
    pending_len: usize,
    pending_boundaries: u16,
    done: bool,
}

impl<'a> Codelets<'a> {
    /// Start encoding `sentence` into codelets. Call [`validate`] first.
    pub const fn new(sentence: &'a EncodeSentence<'a>) -> Self {
        Self {
            words: SentenceWords::new(sentence),
            pending: [0; CODELET_WORDS],
            pending_len: 0,
            pending_boundaries: 0,
            done: false,
        }
    }

    /// Fill `pending` up to one codelet's payload, marking boundaries per slot.
    fn fill(&mut self) {
        const DATA: usize = CODELET_WORDS - 1;
        while self.pending_len < DATA {
            let Some(next) = self.words.next() else {
                self.done = true;
                return;
            };
            self.pending[1 + self.pending_len] = next.word;
            if next.boundary_after {
                self.pending_boundaries |= 1 << (1 + self.pending_len);
            }
            self.pending_len += 1;
        }
    }
}

impl Iterator for Codelets<'_> {
    type Item = [u32; CODELET_WORDS];

    fn next(&mut self) -> Option<[u32; CODELET_WORDS]> {
        const DATA: usize = CODELET_WORDS - 1;
        self.fill();
        if self.pending_len == 0 {
            return None;
        }
        // If the sentence ended inside `pending`, this is the final codelet.
        let complete = self.done;
        let mut codelet = [0u32; CODELET_WORDS];
        codelet.copy_from_slice(&self.pending);
        for slot in 1..=self.pending_len {
            let boundary = self.pending_boundaries & (1 << slot) != 0;
            if boundary == complete {
                codelet[0] |= 1 << slot;
            }
        }
        if complete {
            codelet[0] |= 1;
        }

        // Carry the unused tail of `pending` into the next codelet.
        let tail = self.pending_len.saturating_sub(DATA);
        self.pending = [0; CODELET_WORDS];
        self.pending_len = 0;
        self.pending_boundaries = 0;
        let _ = tail;
        Some(codelet)
    }
}
