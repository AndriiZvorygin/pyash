//! Text to codelets: the front half of the PyAC pipeline.
//!
//! Ported from `~/pyac/lwonprom`:
//!
//! - `program/parser.c`   `first_word_derive`   — word boundary by glyph shape
//! - `program/analyst.c`  `derive_first_word`   — the same, copying the word out
//! - `program/encoding.c` `process_full_word`   — classify a derived word
//! - `program/encoding.c` `neo_phrase_encode`   — place it in the phrase
//! - `program/encoding.c` `neo_independentClause_encoding` — the clause loop
//! - `program/sort.c`     `tablet_word_write` / `tablet_grammar_write`
//!
//! The shape of the thing: scan glyphs into a word, derive that word's length
//! from its glyph pattern, encode it to an HNUC, then append it to the codelet
//! being built. A case word or a mood sets the boundary bit for its slot; every
//! other word leaves it clear. Which appender is used decides that, so the
//! classification ladder is the heart of it.
//!
//! Codelet layout mirrors the C: slot 0 is the summary word carrying the
//! boundary bitmap and the completion bit, slots 1..=15 are payload.
//!
//! The crate is `no_std` with no allocator, so this writes into a caller-supplied
//! codelet buffer and returns how many codelets it filled — the same discipline
//! as `decode_sentence`.

use super::word_code;

/// Payload slots per codelet; slot 0 is the summary word.
pub const CODELET_PAYLOAD: usize = 15;
/// A full codelet, summary word included.
pub const CODELET_WIDTH: usize = CODELET_PAYLOAD + 1;

/// Glyphs that start or continue a consonant.
///
/// The C's `consonant_group` also lists `1`, but the word codec maps `1` to vowel
/// code 6, so classifying it as a consonant here would make words like `l1`
/// unparseable while the codec happily encodes them. The codec's assignment wins:
/// `1` is a vowel.
const CONSONANT_GLYPHS: &[u8] = b"ptkfscxbdgvzjnmqrlyw8h.";
/// Vowels, in the codec's order. `1` and `3` are vowel codes the C's
/// `vowel_group` omits but the word codec assigns.
const VOWEL_GLYPHS: &[u8] = b"iaueo631";
/// Tone marks. `M` is the unmarked tone for the codec but a real glyph here.
const TONE_GLYPHS: &[u8] = b"M72";

/// The quote header the C writes for a numeric literal.
const NUMBER_QUOTE: u32 = 0x881d;
const NUMBER_WORD: u32 = 0x327e;
const REFERENTIAL_WORD: u32 = 0xc8c4;

/// Why a sentence could not be encoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseError {
    /// A glyph that begins no word.
    BadGlyph,
    /// A word-shaped run the codec could not encode.
    Unencodable,
    /// The caller's codelet buffer filled up.
    CodeletCapacity,
    /// Nothing to parse.
    Empty,
}

fn is_consonant(glyph: u8) -> bool {
    CONSONANT_GLYPHS.contains(&glyph)
}

fn is_vowel(glyph: u8) -> bool {
    VOWEL_GLYPHS.contains(&glyph)
}

fn is_tone(glyph: u8) -> bool {
    TONE_GLYPHS.contains(&glyph)
}

/// A glyph that belongs to a word; anything else separates words.
pub fn is_letter(glyph: u8) -> bool {
    is_consonant(glyph) || is_vowel(glyph) || is_tone(glyph)
}

/// Derive the first word's length from its glyph pattern.
///
/// Mirrors `first_word_derive`: a leading consonant is `CV`, `CVT`, `CCVC` or
/// `CCVT`; a leading vowel is a glottal-stopped word, which the C skips into (see
/// [`encode_sentence`]). Returns `None` when no word starts at `text[0]`.
pub fn first_word_length(text: &[u8]) -> Option<usize> {
    if text.len() < 2 {
        return None;
    }
    let first = text[0];
    if is_vowel(first) {
        // Vowel-initial: the next two glyphs must be consonants, and the C then
        // advances into the word rather than returning a length.
        if text.len() < 3 || !is_consonant(text[1]) || !is_consonant(text[2]) {
            return None;
        }
        return Some(0);
    }
    if !is_consonant(first) {
        return None;
    }
    if is_consonant(text[1]) {
        // CCV(T)C or CCVT
        if text.len() < 3 || !is_vowel(text[2]) {
            return None;
        }
        if text.len() >= 4 && is_tone(text[3]) {
            if text.len() < 5 || !is_consonant(text[4]) {
                return None;
            }
            return Some(5);
        }
        if text.len() >= 4 && is_consonant(text[3]) {
            return Some(4);
        }
        return None;
    }
    if is_vowel(text[1]) {
        // CV or CVT
        if text.len() >= 3 && is_tone(text[2]) {
            return Some(3);
        }
        return Some(2);
    }
    None
}

/// The classification a derived word falls into, which picks the appender.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WordClass {
    /// A numeric literal terminator (`do`), which collects the digit run before it.
    Number,
    /// A number-word digit, buffered until a terminator arrives.
    Digit,
    /// A hash name, appended like a lexical value.
    Referential,
    /// A grammatical case word, appended as grammar (sets a boundary).
    Case,
    /// A mood, appended as grammar (sets a boundary).
    Perspective,
    /// Any other word, appended as a lexical value.
    Lexical,
}

/// Grammatical case words, by HNUC, from `grammaticalCase_word_sequence`.
const CASE_WORDS: &[u32] = &[
    0x24de, // nominative
    0x245e, // accusative
    0x255e, // topic
    0x28be, // vocative
    0x215e, // genitive
    0x243e, // destination
    0x207e, // dative
    0x287e, // instrumental
    0x490f, // comitative
    0x4927, // benefactive
    0x414f, // essive
    0x267e, // adpositional
    0x2d5e, // location
    0x265e, // way
    0x313e, // source
    0x4127, // ablative
    0x4957, // elative
    0x4157, // illative
];

/// Mood words, by HNUC, from `perspective_word_sequence`.
const PERSPECTIVE_WORDS: &[u32] = &[
    0x217e, // realis
    0x295e, // deontic
    0x29be, // conditional
    0x213e, // epistemic
    0x21de, // interrogative
    0x227e, // directive
    0x5217, // declarative
    0x4e27, // paragraph
];

/// Number-word digits, `pyash_number_dictionary` in the C. A digit word's index in
/// this list is its value, so a run of them reads as digits in [`NumberFormat`].
const NUMBER_DIGITS: &[(u32, u32)] = &[
    (0x6cd4, 0),  // zron
    (0x2818, 1),  // hyik
    (0xaa0a, 2),  // tyut
    (0x680a, 3),  // tyin
    (0x8942, 4),  // ksas
    (0x2960, 5),  // hfak
    (0x8858, 6),  // hlis
    (0x4848, 7),  // hsip
    (0x4928, 8),  // hwap
    (0x6a2a, 9),  // twun
    (0x4850, 10), // htip
    (0x6b69, 11), // slen
    (0xa98a, 12), // tfat
    (0x8b4a, 13), // tses
    (0x8b48, 14), // hses
    (0xab20, 15), // hpet
];

/// How a numeric literal's digit words combine into a value.
///
/// The C reads the run backwards in base 16, so `hyik tyut do` is 1*16 + 2. That is
/// a historical choice: base 16 needs sixteen digit words and little-endian reads
/// against the direction of speech. Decimal big-endian is the portable default —
/// `do hyik tyut` reads as twelve, in the order it is written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NumberFormat {
    /// Radix. Digit words with a value at or above this are rejected.
    pub base: u32,
    /// Whether the first digit is the most significant.
    pub big_endian: bool,
}

impl NumberFormat {
    /// Decimal, most significant digit first: portable and reads left to right.
    pub const DEFAULT: Self = Self {
        base: 10,
        big_endian: true,
    };

    /// The historical C encoding: base 16, least significant digit first.
    pub const LEGACY_HEX_LITTLE_ENDIAN: Self = Self {
        base: 16,
        big_endian: false,
    };
}

fn number_digit(honuc: u32) -> Option<u32> {
    NUMBER_DIGITS
        .iter()
        .find(|(word, _)| *word == honuc)
        .map(|(_, digit)| *digit)
}

fn classify(honuc: u32) -> WordClass {
    if honuc == NUMBER_WORD {
        WordClass::Number
    } else if honuc == REFERENTIAL_WORD {
        WordClass::Referential
    } else if number_digit(honuc).is_some() {
        // A digit is only a digit after `do` introduces a number; on its own it is
        // an ordinary word (e.g. `hyik` alone is the word "one").
        WordClass::Digit
    } else if CASE_WORDS.contains(&honuc) {
        WordClass::Case
    } else if PERSPECTIVE_WORDS.contains(&honuc) {
        WordClass::Perspective
    } else {
        WordClass::Lexical
    }
}

/// A codelet under construction, writing straight into the caller's buffer.
struct Builder<'a> {
    codelets: &'a mut [[u32; CODELET_WIDTH]],
    count: usize,
    summary: u32,
    used: usize,
}

impl<'a> Builder<'a> {
    fn new(codelets: &'a mut [[u32; CODELET_WIDTH]]) -> Self {
        Self {
            codelets,
            count: 1,
            summary: 0,
            used: 0,
        }
    }

    fn current(&mut self) -> &mut [u32; CODELET_WIDTH] {
        &mut self.codelets[self.count - 1]
    }

    /// Append a payload word, optionally marking it a boundary.
    fn push(&mut self, word: u32, boundary: bool) -> Result<(), ParseError> {
        if self.used == CODELET_PAYLOAD {
            if self.count == self.codelets.len() {
                return Err(ParseError::CodeletCapacity);
            }
            self.seal();
            self.count += 1;
            self.summary = 0;
            self.used = 0;
        }
        let slot = self.used + 1;
        if boundary {
            self.summary |= 1 << slot;
        }
        self.current()[slot] = word;
        self.used += 1;
        Ok(())
    }

    /// Write the summary word for the codelet being filled.
    fn seal(&mut self) {
        let summary = self.summary;
        self.current()[0] = summary;
    }

    /// Fold one digit into the numeric literal already on the codelet.
    ///
    /// The literal's words were pushed when `do` opened it, so the value word is
    /// the last one written. `digits` counts how many have been folded already,
    /// tracked explicitly because leading zeros carry no information in the value.
    fn accumulate_number(
        &mut self,
        digit: u32,
        format: NumberFormat,
        digits: &mut u32,
    ) -> Result<(), ParseError> {
        let last = match self.count.checked_sub(1) {
            Some(index) => index,
            None => return Err(ParseError::CodeletCapacity),
        };
        let slot = self.used;
        if slot == 0 {
            return Err(ParseError::Empty);
        }
        let value = self.codelets[last][slot];
        let folded = if format.big_endian {
            value.wrapping_mul(format.base).wrapping_add(digit)
        } else {
            // Little endian: the first digit is least significant, so each new
            // digit is scaled by the base raised to the count already folded.
            let scale = format.base.saturating_pow(*digits);
            value.wrapping_add(digit.wrapping_mul(scale))
        };
        self.codelets[last][slot] = folded;
        *digits = digits.saturating_add(1);
        Ok(())
    }

    /// Seal the last codelet, marking it complete.
    fn finish(mut self) -> usize {
        let summary = self.summary | 1;
        self.current()[0] = summary;
        self.count
    }
}

/// Encode one PyAC sentence into `codelets`, returning how many were filled.
///
/// The leading-word conventions keep the scan forward-only: `do` introduces a
/// numeric literal and `gi` introduces a name, so neither has to look backwards to
/// find what it applies to. A case word closes the field before it and a mood
/// closes the sentence; both set their slot's boundary bit.
///
/// Uses [`NumberFormat::DEFAULT`]. For the historical C encoding, see
/// [`encode_sentence_with`].
pub fn encode_sentence(
    text: &str,
    codelets: &mut [[u32; CODELET_WIDTH]],
) -> Result<usize, ParseError> {
    encode_sentence_with(text, codelets, NumberFormat::DEFAULT)
}

/// Encode with an explicit number format.
pub fn encode_sentence_with(
    text: &str,
    codelets: &mut [[u32; CODELET_WIDTH]],
    format: NumberFormat,
) -> Result<usize, ParseError> {
    let letters = text.as_bytes();
    if letters.is_empty() {
        return Err(ParseError::Empty);
    }
    if codelets.is_empty() {
        return Err(ParseError::CodeletCapacity);
    }
    let mut builder = Builder::new(codelets);
    let mut index = 0usize;
    // Whether `do` has introduced a numeric literal that is still collecting
    // digits. A leading terminator is what makes the scan forward-only.
    let mut in_number = false;
    let mut number_digits = 0u32;

    while index < letters.len() {
        while index < letters.len() && !is_letter(letters[index]) {
            index += 1;
        }
        if index >= letters.len() {
            break;
        }
        let rest = &letters[index..];
        let Some(length) = first_word_length(rest) else {
            return Err(ParseError::BadGlyph);
        };
        if length == 0 {
            // Vowel-initial: step past the leading vowel and re-derive.
            index += 1;
            continue;
        }
        let word = core::str::from_utf8(&rest[..length]).map_err(|_| ParseError::BadGlyph)?;
        let honuc = u32::from(word_code::encode(word).map_err(|_| ParseError::Unencodable)?);
        index += length;

        // `do` opens a numeric literal and everything numeric after it belongs to
        // that literal, so the digits arrive already in written order.
        if honuc == NUMBER_WORD {
            in_number = true;
            number_digits = 0;
            builder.push(NUMBER_QUOTE, false)?;
            builder.push(0, false)?; // placeholder value, filled as digits arrive
            continue;
        }

        if in_number {
            if let Some(digit) = number_digit(honuc) {
                if digit >= format.base {
                    return Err(ParseError::Unencodable);
                }
                builder.accumulate_number(digit, format, &mut number_digits)?;
                continue;
            }
            in_number = false;
        }

        match classify(honuc) {
            WordClass::Case | WordClass::Perspective => builder.push(honuc, true)?,
            _ => builder.push(honuc, false)?,
        }
    }

    Ok(builder.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cv_word_is_two_glyphs() {
        assert_eq!(first_word_length(b"doka"), Some(2));
    }

    #[test]
    fn a_cvt_word_is_three_glyphs() {
        assert_eq!(first_word_length(b"no7ka"), Some(3));
    }

    #[test]
    fn a_ccvc_word_is_four_glyphs() {
        assert_eq!(first_word_length(b"plustu"), Some(4));
    }

    #[test]
    fn a_ccvt_word_is_five_glyphs() {
        assert_eq!(first_word_length(b"kse7m"), Some(5));
    }

    #[test]
    fn a_vowel_initial_word_asks_the_caller_to_advance() {
        assert_eq!(first_word_length(b"ipla"), Some(0));
    }

    #[test]
    fn separators_are_not_letters() {
        assert!(!is_letter(b' '));
        assert!(is_letter(b'k'));
        assert!(is_letter(b'a'));
        assert!(is_letter(b'7'));
    }
}
