use super::*;

#[inline(always)]
fn read_vector_word<const WORDS: usize>(backing: &[u32; WORDS], word_index: usize) -> u32 {
    #[cfg(target_arch = "spirv")]
    {
        unsafe {
            *<[u32; WORDS] as spirv_std::arch::IndexUnchecked<u32>>::index_unchecked(
                backing, word_index,
            )
        }
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        backing[word_index]
    }
}

#[inline(always)]
fn write_vector_word<const WORDS: usize>(
    backing: &mut [u32; WORDS],
    word_index: usize,
    value: u32,
) {
    #[cfg(target_arch = "spirv")]
    {
        // Frame, argument, and lane bounds are checked by the caller.
        unsafe {
            *<[u32; WORDS] as spirv_std::arch::IndexUnchecked<u32>>::index_unchecked_mut(
                backing, word_index,
            ) = value;
        }
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        backing[word_index] = value;
    }
}

#[inline(always)]
fn vector_word(values: &[u32; RESULT_WORDS], lane: usize) -> u32 {
    #[cfg(target_arch = "spirv")]
    unsafe {
        *<[u32; RESULT_WORDS] as spirv_std::arch::IndexUnchecked<u32>>::index_unchecked(
            values, lane,
        )
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        values[lane]
    }
}

#[inline(always)]
pub(super) fn read_vector_words<const WORDS: usize>(
    backing: &[u32; WORDS],
    base: usize,
) -> [u32; RESULT_WORDS] {
    [
        read_vector_word(backing, base + 0),
        read_vector_word(backing, base + 1),
        read_vector_word(backing, base + 2),
        read_vector_word(backing, base + 3),
        read_vector_word(backing, base + 4),
        read_vector_word(backing, base + 5),
        read_vector_word(backing, base + 6),
        read_vector_word(backing, base + 7),
        read_vector_word(backing, base + 8),
        read_vector_word(backing, base + 9),
        read_vector_word(backing, base + 10),
        read_vector_word(backing, base + 11),
        read_vector_word(backing, base + 12),
        read_vector_word(backing, base + 13),
        read_vector_word(backing, base + 14),
        read_vector_word(backing, base + 15),
        read_vector_word(backing, base + 16),
        read_vector_word(backing, base + 17),
        read_vector_word(backing, base + 18),
        read_vector_word(backing, base + 19),
        read_vector_word(backing, base + 20),
        read_vector_word(backing, base + 21),
        read_vector_word(backing, base + 22),
        read_vector_word(backing, base + 23),
        read_vector_word(backing, base + 24),
        read_vector_word(backing, base + 25),
        read_vector_word(backing, base + 26),
        read_vector_word(backing, base + 27),
        read_vector_word(backing, base + 28),
        read_vector_word(backing, base + 29),
        read_vector_word(backing, base + 30),
        read_vector_word(backing, base + 31),
    ]
}

#[inline(always)]
pub(super) fn write_vector_words<const WORDS: usize>(
    backing: &mut [u32; WORDS],
    base: usize,
    values: &[u32; RESULT_WORDS],
) {
    write_vector_word(backing, base + 0, vector_word(values, 0));
    write_vector_word(backing, base + 1, vector_word(values, 1));
    write_vector_word(backing, base + 2, vector_word(values, 2));
    write_vector_word(backing, base + 3, vector_word(values, 3));
    write_vector_word(backing, base + 4, vector_word(values, 4));
    write_vector_word(backing, base + 5, vector_word(values, 5));
    write_vector_word(backing, base + 6, vector_word(values, 6));
    write_vector_word(backing, base + 7, vector_word(values, 7));
    write_vector_word(backing, base + 8, vector_word(values, 8));
    write_vector_word(backing, base + 9, vector_word(values, 9));
    write_vector_word(backing, base + 10, vector_word(values, 10));
    write_vector_word(backing, base + 11, vector_word(values, 11));
    write_vector_word(backing, base + 12, vector_word(values, 12));
    write_vector_word(backing, base + 13, vector_word(values, 13));
    write_vector_word(backing, base + 14, vector_word(values, 14));
    write_vector_word(backing, base + 15, vector_word(values, 15));
    write_vector_word(backing, base + 16, vector_word(values, 16));
    write_vector_word(backing, base + 17, vector_word(values, 17));
    write_vector_word(backing, base + 18, vector_word(values, 18));
    write_vector_word(backing, base + 19, vector_word(values, 19));
    write_vector_word(backing, base + 20, vector_word(values, 20));
    write_vector_word(backing, base + 21, vector_word(values, 21));
    write_vector_word(backing, base + 22, vector_word(values, 22));
    write_vector_word(backing, base + 23, vector_word(values, 23));
    write_vector_word(backing, base + 24, vector_word(values, 24));
    write_vector_word(backing, base + 25, vector_word(values, 25));
    write_vector_word(backing, base + 26, vector_word(values, 26));
    write_vector_word(backing, base + 27, vector_word(values, 27));
    write_vector_word(backing, base + 28, vector_word(values, 28));
    write_vector_word(backing, base + 29, vector_word(values, 29));
    write_vector_word(backing, base + 30, vector_word(values, 30));
    write_vector_word(backing, base + 31, vector_word(values, 31));
}
