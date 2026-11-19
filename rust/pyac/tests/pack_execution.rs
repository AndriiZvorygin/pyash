use pyac::{
    PyacValue, SemanticError, VectorElements, WORDS_PER_CODELET, decode_pack, encode_pack,
    execute_pack, execute_pack_sections, index_word,
};

const PLUS: [u16; WORDS_PER_CODELET] = [
    0x0149, 0x881d, 1, 0x245e, 0x881d, 1, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0,
];

fn float_quote(value: f32) -> [u16; 3] {
    let bits = value.to_bits();
    [0xd01d, bits as u16, (bits >> 16) as u16]
}

fn float_arithmetic(left: f32, right: f32, operator: u16) -> [u16; WORDS_PER_CODELET] {
    let left = float_quote(left);
    let right = float_quote(right);
    [
        0x0511, left[0], left[1], left[2], 0x245e, right[0], right[1], right[2], 0x243e, operator,
        0x295e, 0, 0, 0, 0, 0,
    ]
}

const FLOAT_LITERAL: [u16; WORDS_PER_CODELET] = [
    0x0031, 0xd01d, 0x0000, 0x3fa0, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

const INVERT: [u16; WORDS_PER_CODELET] = [
    0x0149, 0x881d, 5, 0x245e, 0x881d, 0, 0x207e, 0xaad2, 0x295e, 0, 0, 0, 0, 0, 0, 0,
];

const DATE: [u16; WORDS_PER_CODELET] = [
    0x00c1, 0x981d, 0x9c00, 0x8924, 0x0196, 0, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0,
];

const VECTOR: [u16; WORDS_PER_CODELET] = [
    0x0061, 0x8f1d, 1, 2, 3, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

const TRUTH: [u16; WORDS_PER_CODELET] = [
    0x0015, 0x6909, 0x245e, 0xea30, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

// Lowered from: ob num 5 be equally from num 5 then ob num 7 be number
// else ob num 9 be number ya
const EQUALS_BRANCH: [[u16; WORDS_PER_CODELET]; 2] = [
    [
        0xd6b6, 0x881d, 5, 0x245e, 0x881d, 5, 0x313e, 0x4809, 0x29be, 0x881d, 7, 0x245e, 0xea30,
        0x217e, 0x881d, 9,
    ],
    [
        0x000b, 0x245e, 0xea30, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const TINY_BOOLEAN_BRANCH: [[u16; WORDS_PER_CODELET]; 2] = [
    // Exact lowering of: ob num 3 be tiny from num 5 then ob bool truth
    // be boolean else ob bool lie be boolean ya.
    [
        0xaab6, 0x881d, 3, 0x245e, 0x881d, 5, 0x313e, 0x6c0d, 0x29be, 0x6909, 0x245e, 0x7271,
        0x217e, 0x680d, 0x245e, 0x7271,
    ],
    [0x0003, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

// Lowered from the canonical Pyash local-variable flow in
// examples/pyash/vliw-programlet-local-slots.pya, narrowed to one ceremony
// and a direct final invocation (no nested calls in this parity slice).
const LOCAL_NUMBER_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 6] = [
    [
        0x5211, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0,
        0x6357, 0xe8c9, 0x5217, 0,
    ],
    [
        0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0x0509, 0x881d, 1, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

// Lowered from the canonical local-slot example with both ceremonies and its
// final `count twice` invocation.
const NESTED_NUMERIC_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 11] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0x0509, 0x881d, 1, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0a11, 0x225e, 0xaa90, 0x892a, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x0920, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0xa86a, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0019, 0x225e, 0xa86a, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x892a, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x892a, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

// Lowered from a parameterized `plus two` ceremony. The `ob num` argument is
// bound through `this`, incremented in a local slot, and returned by name.
const PARAMETERIZED_NESTED_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 6] = [
    [
        0x5091, 0x225e, 0x8a64, 0xaa0a, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930,
        0x243e, 0xe8c9, 0x5217, 0,
    ],
    [
        0x5209, 0x225e, 0xaa90, 0x24de, 0x4a57, 0x215e, 0x245e, 0x215e, 0x327e, 0x245e, 0x225e,
        0xc8c4, 0x414f, 0xea30, 0x217e, 0,
    ],
    [
        0x0509, 0x881d, 2, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x245e, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0x8a64, 0xaa0a, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0909, 0x881d, 5, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0xaa0a, 0x295e,
        0, 0, 0, 0,
    ],
];

// The outer ceremony forwards its numeric case argument into `plus two`,
// which binds it through `this`, updates a local, and returns that local.
const FORWARDED_CASE_ARGUMENT_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 11] = [
    [
        0x5091, 0x225e, 0x8a64, 0xaa0a, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930,
        0x243e, 0xe8c9, 0x5217, 0,
    ],
    [
        0x5209, 0x225e, 0xaa90, 0x24de, 0x4a57, 0x215e, 0x245e, 0x215e, 0x327e, 0x245e, 0x225e,
        0xc8c4, 0x414f, 0xea30, 0x217e, 0,
    ],
    [
        0x0509, 0x881d, 2, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x245e, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0x8a64, 0xaa0a, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x5091, 0x225e, 0xaa90, 0x892a, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930,
        0x243e, 0xe8c9, 0x5217, 0,
    ],
    [
        0x5209, 0x225e, 0xaa90, 0x24de, 0x4a57, 0x215e, 0x245e, 0x215e, 0x327e, 0x245e, 0x225e,
        0xc8c4, 0x414f, 0xea30, 0x217e, 0,
    ],
    [
        0x0909, 0x225e, 0xaa90, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x8a64, 0xaa0a,
        0x295e, 0, 0, 0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x245e, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x892a, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0909, 0x881d, 5, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x892a, 0x295e,
        0, 0, 0, 0,
    ],
];

const MUTABLE_BOOLEAN_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 6] = [
    [
        0x2851, 0x225e, 0xaa90, 0x8918, 0x24de, 0x680d, 0x245e, 0x225e, 0x538f, 0x225e, 0x4930,
        0x243e, 0xe8c9, 0x5217, 0, 0,
    ],
    [
        0x0529, 0x225e, 0xaa90, 0x24de, 0x6909, 0x245e, 0x225e, 0xc8c4, 0x414f, 0x7271, 0x217e, 0,
        0, 0, 0, 0,
    ],
    [
        0x0285, 0x680d, 0x245e, 0x225e, 0x538f, 0x225e, 0xaa90, 0x243e, 0x7271, 0x295e, 0, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x245e, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0485, 0x6909, 0x245e, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0,
        0, 0, 0, 0,
    ],
];

const BOOLEAN_COMPARISON_BRANCH_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 7] = [
    [
        0x2851, 0x225e, 0xaa90, 0x8918, 0x24de, 0x680d, 0x245e, 0x225e, 0x538f, 0x225e, 0x4930,
        0x243e, 0xe8c9, 0x5217, 0, 0,
    ],
    [
        0x0529, 0x225e, 0xaa90, 0x24de, 0x6909, 0x245e, 0x225e, 0xc8c4, 0x414f, 0x7271, 0x217e, 0,
        0, 0, 0, 0,
    ],
    [
        0xbd56, 0x225e, 0xaa90, 0x245e, 0x6909, 0x313e, 0x4809, 0x29be, 0x680d, 0x245e, 0x225e,
        0x538f, 0x225e, 0x4930, 0x243e, 0x7271,
    ],
    [
        0x050b, 0x295e, 0x6909, 0x245e, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0x7271, 0x295e, 0,
        0, 0, 0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0485, 0x680d, 0x245e, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0,
        0, 0, 0, 0,
    ],
];

const BOOLEAN_ARGUMENT_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 5] = [
    [
        0x2851, 0x225e, 0xaa90, 0x8918, 0x24de, 0x680d, 0x245e, 0x225e, 0x538f, 0x225e, 0x4930,
        0x243e, 0xe8c9, 0x5217, 0, 0,
    ],
    [
        0x5209, 0x225e, 0xaa90, 0x24de, 0x4a57, 0x215e, 0x245e, 0x215e, 0x538f, 0x245e, 0x225e,
        0xc8c4, 0x414f, 0x7271, 0x217e, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x245e, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0485, 0x6909, 0x245e, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0,
        0, 0, 0, 0,
    ],
];

const LOOPING_NUMERIC_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 5] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0509, 0x881d, 1, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x4921, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 1, 0x6357, 0x881d, 4, 0x4e4f,
        0xaa90, 0x8918, 0x295e, 0,
    ],
];

const LOOP_CURSOR_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 5] = [
    [
        0x5211, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0,
        0x6357, 0xe8c9, 0x5217, 0,
    ],
    [
        0x5209, 0x225e, 0xaa90, 0x24de, 0x4a57, 0x215e, 0x6357, 0x215e, 0x327e, 0x245e, 0x225e,
        0xc8c4, 0x414f, 0xea30, 0x217e, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x4921, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 1, 0x6357, 0x881d, 4, 0x4e4f,
        0xaa90, 0x8918, 0x295e, 0,
    ],
];

// Lowered from a loop body that explicitly returns `fromindex 5` when the
// current index reaches 2. The loop supervisor must stop at that returned
// bound and retain the current index as the result.
const LOOP_EARLY_RETURN_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 7] = [
    [
        0x6dee, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0,
        0x6357, 0x881d, 0, 0x4e4f,
    ],
    [
        0x0005, 0xe8c9, 0x5217, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x5209, 0x225e, 0x4930, 0x24de, 0x4a57, 0x215e, 0x6357, 0x215e, 0x327e, 0x245e, 0x225e,
        0xc8c4, 0x414f, 0xea30, 0x217e, 0,
    ],
    [
        0xc149, 0x225e, 0x4930, 0x245e, 0x881d, 2, 0x313e, 0x4809, 0x29be, 0x4a57, 0x215e, 0x4e4f,
        0x215e, 0x327e, 0x6357, 0xa828,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x4921, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 1, 0x6357, 0x881d, 5, 0x4e4f,
        0xaa90, 0x8918, 0x295e, 0,
    ],
];

const EMPTY_NESTED_LOOP_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 10] = [
    [
        0x5211, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0,
        0x6357, 0xe8c9, 0x5217, 0,
    ],
    [
        0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0x0509, 0x881d, 1, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0a11, 0x225e, 0xaa90, 0x892a, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x4921, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 2, 0x6357, 0x881d, 2, 0x4e4f,
        0xaa90, 0x8918, 0x295e, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x892a, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x892a, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

// Lowered from nested bounded loops: count twice calls count once three times
// for each of its own three iterations. The inner call stores its return in
// `second`, distinct from the callee's declared output name `answer`.
const NESTED_BOUNDED_LOOP_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 13] = [
    [
        0x6dee, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0,
        0x6357, 0x881d, 0, 0x4e4f,
    ],
    [5, 0xe8c9, 0x5217, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [
        0x0509, 0x881d, 1, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x6dee, 0x225e, 0xaa90, 0x892a, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0,
        0x6357, 0x881d, 0, 0x4e4f,
    ],
    [5, 0xe8c9, 0x5217, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [
        0x0a49, 0x225e, 0xa86a, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0x4921, 0x225e, 0x327e, 0x225e, 0xa86a, 0x243e, 0x881d, 0, 0x6357, 0x881d, 3, 0x4e4f,
        0xaa90, 0x8918, 0x295e, 0,
    ],
    [
        0x0509, 0x225e, 0xa86a, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0x295e, 0,
        0, 0, 0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x892a, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x4921, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 1, 0x6357, 0x881d, 4, 0x4e4f,
        0xaa90, 0x892a, 0x295e, 0,
    ],
];

const LOCAL_COMPARISON_BRANCH_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 8] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x1449, 0x225e, 0xe9a2, 0x24de, 0x881d, 3, 0x245e, 0x225e, 0x0b50, 0xea30, 0x414f, 0xea30,
        0x217e, 0, 0, 0,
    ],
    [
        0x0a49, 0x225e, 0x4930, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0xf6b6, 0x225e, 0xe9a2, 0x245e, 0x881d, 3, 0x313e, 0x4809, 0x29be, 0x881d, 1, 0x245e,
        0x225e, 0x327e, 0x225e, 0x4930,
    ],
    [
        0x000b, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const BOOLEAN_LOCAL_COMPARISON_BRANCH_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 8] = [
    [
        0x5091, 0x225e, 0xaaa2, 0x8918, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930,
        0x243e, 0xe8c9, 0x5217, 0,
    ],
    [
        0x5209, 0x225e, 0xaa90, 0x24de, 0x4a57, 0x215e, 0x245e, 0x215e, 0x327e, 0x245e, 0x225e,
        0xc8c4, 0x414f, 0xea30, 0x217e, 0,
    ],
    [
        0x756e, 0x257e, 0x225e, 0xaa90, 0x245e, 0x881d, 5, 0x313e, 0x4809, 0x295e, 0x305e, 0x245e,
        0x257e, 0x225e, 0xaa90, 0x245e,
    ],
    [
        0xed56, 0x881d, 3, 0x313e, 0x69b3, 0x295e, 0x305e, 0x490f, 0x24be, 0x29be, 0x881d, 1,
        0x245e, 0x225e, 0x327e, 0x225e,
    ],
    [
        0x5095, 0x4930, 0x243e, 0x8a64, 0x295e, 0x881d, 2, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930,
        0x243e, 0x8a64, 0x295e, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaaa2, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0909, 0x881d, 5, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaaa2, 0x8918, 0x295e,
        0, 0, 0, 0,
    ],
];

const BRANCH_WITH_ALTERNATIVE_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 7] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 5, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0xf6b6, 0x225e, 0xaa90, 0x245e, 0x881d, 5, 0x313e, 0x6c0d, 0x29be, 0x881d, 1, 0x245e,
        0x225e, 0x327e, 0x225e, 0x4930,
    ],
    [
        0x284b, 0x243e, 0x8a64, 0x295e, 0x881d, 2, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e,
        0x8a64, 0x295e, 0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const ALTERNATIVE_BRANCH_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 8] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0a49, 0x225e, 0x4930, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0xf6b6, 0x881d, 7, 0x245e, 0x881d, 5, 0x313e, 0x6c0d, 0x29be, 0x881d, 2, 0x245e, 0x225e,
        0x327e, 0x225e, 0x4930,
    ],
    [
        0x000b, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0509, 0x881d, 9, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const BOOLEAN_CALL_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 13] = [
    [
        0x0509, 0x225e, 0x6909, 0x24de, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0xe8c9, 0x5217, 0,
        0, 0, 0, 0,
    ],
    [
        0x000d, 0x6909, 0x245e, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0029, 0x225e, 0x6909, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0509, 0x225e, 0x680d, 0x24de, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0xe8c9, 0x5217, 0,
        0, 0, 0, 0,
    ],
    [
        0x000d, 0x680d, 0x245e, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0029, 0x225e, 0x680d, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 1, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0xf6b6, 0x225e, 0xaa90, 0x245e, 0x881d, 1, 0x313e, 0x4809, 0x29be, 0x225e, 0x6909, 0x24de,
        0x225e, 0x538f, 0x225e, 0x4930,
    ],
    [
        0x284b, 0x243e, 0x6909, 0x295e, 0x225e, 0x680d, 0x24de, 0x225e, 0x538f, 0x225e, 0x4930,
        0x243e, 0x680d, 0x295e, 0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x538f, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const MULTIPLY_LOCAL_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 6] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x1449, 0x225e, 0xaa90, 0x24de, 0x881d, 6, 0x245e, 0x225e, 0x0b50, 0xea30, 0x414f, 0xea30,
        0x217e, 0, 0, 0,
    ],
    [
        0x2909, 0x225e, 0xaa90, 0x313e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 7, 0x287e,
        0xec90, 0x295e, 0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const SIGNED_INVERT_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 6] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 5, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0x0509, 0x225e, 0xaa90, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0xaad2, 0x295e, 0,
        0, 0, 0, 0,
    ],
    [
        0x0019, 0x225e, 0xaa90, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const NUMERIC_OPERATOR_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 13] = [
    [
        0x0a11, 0x225e, 0xaa90, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x1449, 0x225e, 0xaa90, 0x24de, 0x881d, 6, 0x245e, 0x225e, 0x0b50, 0xea30, 0x414f, 0xea30,
        0x217e, 0, 0, 0,
    ],
    [
        0x0a49, 0x225e, 0x4930, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e,
        0, 0, 0, 0,
    ],
    [
        0x2909, 0x225e, 0xaa90, 0x313e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 7, 0x287e,
        0xec90, 0x295e, 0, 0,
    ],
    [
        0x2909, 0x225e, 0x4930, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 2, 0x287e,
        0x8893, 0x295e, 0, 0,
    ],
    [
        0x2849, 0x225e, 0x4930, 0x245e, 0x881d, 2, 0x313e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e,
        0x8c29, 0x295e, 0, 0,
    ],
    [
        0x2849, 0x225e, 0x4930, 0x245e, 0x881d, 5, 0x313e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e,
        0xe82a, 0x295e, 0, 0,
    ],
    [
        0x2909, 0x225e, 0x4930, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 7, 0x490f,
        0xa810, 0x295e, 0, 0,
    ],
    [
        0x0509, 0x881d, 2, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xabd2, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0509, 0x881d, 3, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const NESTED_SIGNED_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 10] = [
    SIGNED_INVERT_PROGRAMLET[0],
    SIGNED_INVERT_PROGRAMLET[1],
    SIGNED_INVERT_PROGRAMLET[2],
    SIGNED_INVERT_PROGRAMLET[3],
    SIGNED_INVERT_PROGRAMLET[4],
    [
        0x0a11, 0x225e, 0xaa90, 0x892a, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
        0x5217, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0051, 0x225e, 0xaa90, 0x892a, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x892a, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ],
];

const SIGNED_COMPARISON_PROGRAMLET: [[u16; WORDS_PER_CODELET]; 9] = [
    SIGNED_INVERT_PROGRAMLET[0],
    SIGNED_INVERT_PROGRAMLET[1],
    SIGNED_INVERT_PROGRAMLET[2],
    [
        0xf6b6, 0x225e, 0xaa90, 0x245e, 0x881d, 0, 0x313e, 0x6c0d, 0x29be, 0x881d, 1, 0x245e,
        0x225e, 0x327e, 0x225e, 0x4930,
    ],
    [
        0x000b, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        0x0509, 0x881d, 2, 0x245e, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0x295e, 0, 0, 0,
        0, 0,
    ],
    [
        0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    SIGNED_INVERT_PROGRAMLET[4],
    SIGNED_INVERT_PROGRAMLET[5],
];

fn run_numeric_programlet(
    codelets: &[[u16; WORDS_PER_CODELET]],
    step_budget: u32,
) -> pyac_vliw_core::CoreResult {
    let words = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    let mut sentence_words = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
    let mut sentence_boundaries = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
    let mut symbols = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
    let mut frames =
        [pyac_vliw_core::ProgramletFrame::EMPTY; pyac_vliw_core::MAX_PROGRAMLET_CALL_DEPTH];
    pyac_vliw_core::execute_numeric_programlet(
        &words,
        codelets.len(),
        step_budget,
        &mut sentence_words,
        &mut sentence_boundaries,
        &mut symbols,
        &mut frames,
    )
}

#[test]
fn executes_mixed_supported_codelet_families_in_pack_order() {
    let bytes = encode_pack(&[PLUS, INVERT, DATE, VECTOR, TRUTH]).expect("pack fits");
    let pack = decode_pack(&bytes).expect("pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Unsigned(2),
            PyacValue::Signed(-5),
            PyacValue::DateEpochMs(1_746_057_600_000),
            PyacValue::Vector(VectorElements::Numbers(vec![1, 2, 3])),
            PyacValue::Boolean(true),
        ])
    );
}

#[test]
fn executes_f32_quotes_and_arithmetic_through_the_shared_pack_runtime() {
    let cases = [
        (0.1, 0.2, 0x8a64, 0.1f32 + 0.2f32),
        (5.5, 2.0, 0xabd2, 5.5f32 - 2.0f32),
        (1.5, 2.0, 0xec90, 1.5f32 * 2.0f32),
        (1.5, 4.0, 0x8893, 1.5f32 / 4.0f32),
    ];
    let codelets = cases
        .iter()
        .map(|(left, right, operator, _)| float_arithmetic(*left, *right, *operator))
        .collect::<Vec<_>>();
    let pack =
        decode_pack(&encode_pack(&codelets).expect("f32 pack fits")).expect("f32 pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(cases
            .iter()
            .map(|(_, _, _, result)| PyacValue::Float32(result.to_bits()))
            .collect())
    );

    let literal_pack = decode_pack(&encode_pack(&[FLOAT_LITERAL]).expect("literal pack fits"))
        .expect("literal pack decodes");
    assert_eq!(
        execute_pack(&literal_pack),
        Ok(vec![PyacValue::Float32(1.25f32.to_bits())])
    );
}

#[test]
fn executes_float32_and_float64_vectors_through_the_shared_pack_runtime() {
    let f32_values = [1.25f32.to_bits(), (-0.5f32).to_bits()];
    let f32_vector = [
        0x00c1,
        0xd11d,
        f32_values[0] as u16,
        (f32_values[0] >> 16) as u16,
        f32_values[1] as u16,
        (f32_values[1] >> 16) as u16,
        0x245e,
        0x217e,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let f64_values = [std::f64::consts::PI.to_bits(), (-0.0f64).to_bits()];
    let f64_vector = [
        0x0c01,
        0xd91d,
        f64_values[0] as u16,
        (f64_values[0] >> 16) as u16,
        (f64_values[0] >> 32) as u16,
        (f64_values[0] >> 48) as u16,
        f64_values[1] as u16,
        (f64_values[1] >> 16) as u16,
        (f64_values[1] >> 32) as u16,
        (f64_values[1] >> 48) as u16,
        0x245e,
        0x217e,
        0,
        0,
        0,
        0,
    ];
    let pack =
        decode_pack(&encode_pack(&[f32_vector, f64_vector]).expect("float vector pack fits"))
            .expect("float vector pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Vector(VectorElements::Float32(f32_values.to_vec())),
            PyacValue::Vector(VectorElements::Float64(f64_values.to_vec())),
        ])
    );
}

#[test]
fn executes_fixed16_quotes_and_arithmetic_through_the_shared_pack_runtime() {
    let fixed = |left, right, operator| {
        [
            0x0149, 0xc81d, left, 0x245e, 0xc81d, right, 0x243e, operator, 0x295e, 0, 0, 0, 0, 0,
            0, 0,
        ]
    };
    let codelets = [
        fixed(23_328, 11_664, 0x8a64),
        fixed(23_328, 11_664, 0xabd2),
        fixed(23_328, 23_328, 0xec90),
        fixed(11_664, 23_328, 0x8893),
    ];
    let pack = decode_pack(&encode_pack(&codelets).expect("fixed16 pack fits"))
        .expect("fixed16 pack decodes");
    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Fixed16(34_992),
            PyacValue::Fixed16(11_664),
            PyacValue::Fixed16(11_664),
            PyacValue::Fixed16(23_328),
        ])
    );

    let literal = [
        0x0019, 0xc81d, 5_832, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    let pack = decode_pack(&encode_pack(&[literal]).expect("literal pack fits"))
        .expect("literal pack decodes");
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Fixed16(5_832)]));
}

#[test]
fn shared_pack_runtime_reports_fixed16_range_errors() {
    let arithmetic = |left, right, operator| {
        [
            0x0149, 0xc81d, left, 0x245e, 0xc81d, right, 0x243e, operator, 0x295e, 0, 0, 0, 0, 0,
            0, 0,
        ]
    };
    let overflow = decode_pack(&encode_pack(&[arithmetic(u16::MAX, 1, 0x8a64)]).unwrap()).unwrap();
    assert_eq!(
        execute_pack(&overflow).unwrap_err().code(),
        "fixed16-domain"
    );
    let underflow = decode_pack(&encode_pack(&[arithmetic(0, 1, 0xabd2)]).unwrap()).unwrap();
    assert_eq!(
        execute_pack(&underflow).unwrap_err().code(),
        "fixed16-domain"
    );
}

#[test]
fn shared_pack_runtime_rejects_non_finite_f32_values_and_results() {
    let infinity = [
        0x0031, 0xd01d, 0, 0x7f80, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    let pack = decode_pack(&encode_pack(&[infinity]).expect("pack fits")).expect("pack decodes");
    let error = execute_pack(&pack).expect_err("infinity is rejected");
    assert_eq!(error.code(), "non-finite-float");

    let overflow = float_arithmetic(f32::MAX, 2.0, 0xec90);
    let pack = decode_pack(&encode_pack(&[overflow]).expect("pack fits")).expect("pack decodes");
    let error = execute_pack(&pack).expect_err("overflow is rejected");
    assert_eq!(error.code(), "non-finite-float");
}

#[test]
fn executes_canonical_numeric_local_declaration_write_and_return() {
    let bytes = encode_pack(&LOCAL_NUMBER_PROGRAMLET).expect("programlet pack fits");
    let pack = decode_pack(&bytes).expect("programlet pack decodes");
    let result = run_numeric_programlet(
        &LOCAL_NUMBER_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 1);
    let repeated = run_numeric_programlet(
        &LOCAL_NUMBER_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(repeated.error, 0, "{repeated:?}");
    assert_eq!(
        repeated.values[0], 1,
        "each invocation starts with a fresh local frame"
    );

    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(1)]));
}

#[test]
fn executes_nested_ceremony_calls_with_isolated_local_frames() {
    let bytes = encode_pack(&NESTED_NUMERIC_PROGRAMLET).expect("nested programlet pack fits");
    let pack = decode_pack(&bytes).expect("nested programlet pack decodes");
    let result = run_numeric_programlet(
        &NESTED_NUMERIC_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");

    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(1)]));
}

#[test]
fn passes_typed_case_arguments_through_nested_programlet_frames() {
    let bytes = encode_pack(&PARAMETERIZED_NESTED_PROGRAMLET).expect("parameterized pack fits");
    let pack = decode_pack(&bytes).expect("parameterized pack decodes");
    let result = run_numeric_programlet(
        &PARAMETERIZED_NESTED_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 7);
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(7)]));
}

#[test]
fn forwards_a_case_argument_from_one_programlet_to_a_nested_call() {
    let bytes = encode_pack(&FORWARDED_CASE_ARGUMENT_PROGRAMLET).expect("forwarding pack fits");
    let pack = decode_pack(&bytes).expect("forwarding pack decodes");
    let result = run_numeric_programlet(
        &FORWARDED_CASE_ARGUMENT_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 7);
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(7)]));

    let mut local_genitive_argument = FORWARDED_CASE_ARGUMENT_PROGRAMLET;
    local_genitive_argument[7] = [
        0x1211, 0xaa90, 0x215e, 0x327e, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x8a64,
        0xaa0a, 0x295e, 0, 0, 0,
    ];
    let result = run_numeric_programlet(
        &local_genitive_argument,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 7);
}

#[test]
fn initializes_mutates_and_returns_a_boolean_local() {
    let bytes = encode_pack(&MUTABLE_BOOLEAN_PROGRAMLET).expect("boolean pack fits");
    let pack = decode_pack(&bytes).expect("boolean pack decodes");
    let result = run_numeric_programlet(
        &MUTABLE_BOOLEAN_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, pyac_vliw_core::VALUE_BOOLEAN);
    assert_eq!(result.values[0], 0);
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Boolean(false)]));
}

#[test]
fn compares_boolean_locals_and_selects_the_matching_branch_arm() {
    let mut true_case = BOOLEAN_COMPARISON_BRANCH_PROGRAMLET;
    let true_result =
        run_numeric_programlet(&true_case, pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET);
    assert_eq!(true_result.error, 0, "{true_result:?}");
    assert_eq!(true_result.value_kind, pyac_vliw_core::VALUE_BOOLEAN);
    assert_eq!(true_result.values[0], 0);

    true_case[1][4] = 0x680d;
    let false_result =
        run_numeric_programlet(&true_case, pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET);
    assert_eq!(false_result.error, 0, "{false_result:?}");
    assert_eq!(false_result.values[0], 1);
}

#[test]
fn binds_boolean_case_arguments_to_typed_this_local_declarations() {
    let bytes = encode_pack(&BOOLEAN_ARGUMENT_PROGRAMLET).expect("boolean argument pack fits");
    let pack = decode_pack(&bytes).expect("boolean argument pack decodes");
    let result = run_numeric_programlet(
        &BOOLEAN_ARGUMENT_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, pyac_vliw_core::VALUE_BOOLEAN);
    assert_eq!(result.values[0], 1);
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Boolean(true)]));
}

#[test]
fn canonical_programlet_rejects_constant_writes() {
    let mut constant_write = LOCAL_NUMBER_PROGRAMLET;
    constant_write[1] = [
        0x1449, 0x225e, 0xaa90, 0x24de, 0x881d, 0, 0x245e, 0x225e, 0x0b50, 0xea30, 0x414f, 0xea30,
        0x217e, 0, 0, 0,
    ];
    let result = run_numeric_programlet(
        &constant_write,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, pyac_vliw_core::ERROR_CONSTANT_WRITE);
}

#[test]
fn executes_bounded_fromindex_toindex_programlet_loops() {
    let result = run_numeric_programlet(
        &LOOPING_NUMERIC_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 3);

    let exhausted = run_numeric_programlet(&LOOPING_NUMERIC_PROGRAMLET, 5);
    assert_eq!(exhausted.error, pyac_vliw_core::ERROR_STEP_BUDGET);

    for budget in 6..=8 {
        let exhausted = run_numeric_programlet(&LOOPING_NUMERIC_PROGRAMLET, budget);
        assert_eq!(exhausted.error, pyac_vliw_core::ERROR_STEP_BUDGET);
    }

    let exact_budget = run_numeric_programlet(&LOOPING_NUMERIC_PROGRAMLET, 9);
    assert_eq!(exact_budget.error, 0, "{exact_budget:?}");
    assert_eq!(exact_budget.values[0], 3);
}

#[test]
fn exposes_the_current_loop_index_and_skips_equal_bounds() {
    let result = run_numeric_programlet(
        &LOOP_CURSOR_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 3, "fromindex 1 toindex 4 visits 1, 2, 3");

    let mut empty_range = LOOP_CURSOR_PROGRAMLET;
    empty_range[4][7] = 4;
    let result =
        run_numeric_programlet(&empty_range, pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 0, "equal loop bounds skip the body");
}

#[test]
fn explicit_fromindex_return_updates_loop_supervisor_state() {
    let bytes = encode_pack(&LOOP_EARLY_RETURN_PROGRAMLET).expect("programlet pack fits");
    let pack = decode_pack(&bytes).expect("programlet pack decodes");
    let result = run_numeric_programlet(
        &LOOP_EARLY_RETURN_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );

    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 2, "cursor 2 returns the loop to bound 5");
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(2)]));
}

#[test]
fn nested_empty_loop_skips_the_callee_body() {
    let result = run_numeric_programlet(
        &EMPTY_NESTED_LOOP_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(
        result.values[0], 0,
        "equal nested loop bounds skip the callee body"
    );
}

#[test]
fn nested_bounded_loops_keep_independent_frame_cursors() {
    let bytes = encode_pack(&NESTED_BOUNDED_LOOP_PROGRAMLET).expect("nested loop pack fits");
    let pack = decode_pack(&bytes).expect("nested loop pack decodes");
    let result = run_numeric_programlet(
        &NESTED_BOUNDED_LOOP_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );

    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(
        result.values[0], 9,
        "three inner iterations per outer iteration"
    );
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(9)]));

    let mut repeated_calls = NESTED_BOUNDED_LOOP_PROGRAMLET;
    repeated_calls[12][10] = 300;
    let repeated = run_numeric_programlet(
        &repeated_calls,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(repeated.error, 0, "{repeated:?}");
    assert_eq!(
        repeated.values[0], 897,
        "299 outer iterations times 3 inner iterations"
    );
}

#[test]
fn evaluates_programlet_comparisons_against_local_slots() {
    let result = run_numeric_programlet(
        &LOCAL_COMPARISON_BRANCH_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 1);
}

#[test]
fn composes_local_comparison_leaves_in_programlet_branches() {
    let run_core = |programlet: &[[u16; WORDS_PER_CODELET]; 8]| {
        let words = programlet
            .iter()
            .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
            .collect::<Vec<_>>();
        let mut sentence_words = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
        let mut sentence_boundaries = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
        let mut symbols = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
        let mut frames =
            [pyac_vliw_core::ProgramletFrame::EMPTY; pyac_vliw_core::MAX_PROGRAMLET_CALL_DEPTH];
        pyac_vliw_core::execute_numeric_programlet(
            &words,
            programlet.len(),
            pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
            &mut sentence_words,
            &mut sentence_boundaries,
            &mut symbols,
            &mut frames,
        )
    };
    let direct = run_core(&BOOLEAN_LOCAL_COMPARISON_BRANCH_PROGRAMLET);
    assert_eq!(direct.error, 0, "{direct:?}");
    assert_eq!(direct.values[0], 1);
    let bytes = encode_pack(&BOOLEAN_LOCAL_COMPARISON_BRANCH_PROGRAMLET)
        .expect("boolean comparison branch pack fits");
    let pack = decode_pack(&bytes).expect("boolean comparison branch pack decodes");
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(1)]));

    let mut false_branch = BOOLEAN_LOCAL_COMPARISON_BRANCH_PROGRAMLET;
    false_branch[7][2] = 2;
    let direct_false = run_core(&false_branch);
    assert_eq!(direct_false.error, 0, "{direct_false:?}");
    assert_eq!(direct_false.values[0], 2);
    let bytes = encode_pack(&false_branch).expect("false branch pack fits");
    let pack = decode_pack(&bytes).expect("false branch pack decodes");
    assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Unsigned(2)]));
}

#[test]
fn executes_only_the_selected_programlet_branch_arm() {
    let result = run_numeric_programlet(
        &ALTERNATIVE_BRANCH_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 9);
}

#[test]
fn selects_explicit_programlet_alternative_arms_for_true_and_false_predicates() {
    let mut true_branch = BRANCH_WITH_ALTERNATIVE_PROGRAMLET;
    true_branch[2][5] = 6;
    let true_result =
        run_numeric_programlet(&true_branch, pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET);
    assert_eq!(true_result.error, 0, "{true_result:?}");
    assert_eq!(true_result.values[0], 1);

    let false_result = run_numeric_programlet(
        &BRANCH_WITH_ALTERNATIVE_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(false_result.error, 0, "{false_result:?}");
    assert_eq!(false_result.values[0], 2);
}

#[test]
fn preserves_boolean_types_through_branch_calls_and_returns() {
    let result = run_numeric_programlet(
        &BOOLEAN_CALL_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, pyac_vliw_core::VALUE_BOOLEAN);
    assert_eq!(result.values[0], 1);

    let bytes = encode_pack(&BOOLEAN_CALL_PROGRAMLET).expect("bool programlet pack fits");
    assert_eq!(
        execute_pack(&decode_pack(&bytes).expect("bool pack decodes")),
        Ok(vec![PyacValue::Boolean(true)])
    );

    let mut false_branch = BOOLEAN_CALL_PROGRAMLET;
    false_branch[7][5] = 0;
    let result = run_numeric_programlet(
        &false_branch,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, pyac_vliw_core::VALUE_BOOLEAN);
    assert_eq!(result.values[0], 0);
}

#[test]
fn executes_multiply_using_named_local_operands() {
    let result = run_numeric_programlet(
        &MULTIPLY_LOCAL_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 42);
}

#[test]
fn preserves_signed_numeric_values_through_programlet_calls_and_returns() {
    let result = run_numeric_programlet(
        &SIGNED_INVERT_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, pyac_vliw_core::VALUE_SIGNED);
    assert_eq!(result.values[0] as i32, -5);

    let bytes = encode_pack(&SIGNED_INVERT_PROGRAMLET).expect("signed programlet pack fits");
    assert_eq!(
        execute_pack(&decode_pack(&bytes).expect("signed pack decodes")),
        Ok(vec![PyacValue::Signed(-5)])
    );
}

#[test]
fn executes_chained_programlet_arithmetic_operators_and_preserves_intermediates() {
    let result = run_numeric_programlet(
        &NUMERIC_OPERATOR_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 7);

    let bytes = encode_pack(&NUMERIC_OPERATOR_PROGRAMLET).expect("operator programlet pack fits");
    assert_eq!(
        execute_pack(&decode_pack(&bytes).expect("operator pack decodes")),
        Ok(vec![PyacValue::Unsigned(7)])
    );
}

#[test]
fn propagates_signed_results_through_nested_programlet_frames() {
    let result = run_numeric_programlet(
        &NESTED_SIGNED_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, pyac_vliw_core::VALUE_SIGNED);
    assert_eq!(result.values[0] as i32, -5);

    let bytes = encode_pack(&NESTED_SIGNED_PROGRAMLET).expect("nested signed pack fits");
    assert_eq!(
        execute_pack(&decode_pack(&bytes).expect("nested signed pack decodes")),
        Ok(vec![PyacValue::Signed(-5)])
    );
}

#[test]
fn compares_signed_local_values_in_programlet_branches() {
    let result = run_numeric_programlet(
        &SIGNED_COMPARISON_PROGRAMLET,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
    );
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(
        result.values[0], 3,
        "the following sentence is sequential, not an else arm"
    );
}

#[test]
fn mixed_pack_failure_reports_the_original_codelet_index() {
    let bytes = encode_pack(&[PLUS, [0; WORDS_PER_CODELET]]).expect("pack fits");
    let pack = decode_pack(&bytes).expect("pack decodes");

    let error = execute_pack(&pack).expect_err("unknown codelet is unsupported");
    assert_eq!(error.index, 1);
    assert_eq!(error.source, SemanticError::UnsupportedCodelet);
    assert_eq!(error.code(), "unsupported-codelet");
}

#[test]
fn executes_a_pyash_equal_conditional_and_selects_one_numeric_arm() {
    let equal_pack = encode_pack(&EQUALS_BRANCH).expect("conditional pack fits");
    assert_eq!(
        execute_pack(&decode_pack(&equal_pack).expect("conditional pack decodes")),
        Ok(vec![PyacValue::Unsigned(7)])
    );

    let mut unequal = EQUALS_BRANCH;
    unequal[0][5] = 4;
    let unequal_pack = encode_pack(&unequal).expect("conditional pack fits");
    assert_eq!(
        execute_pack(&decode_pack(&unequal_pack).expect("conditional pack decodes")),
        Ok(vec![PyacValue::Unsigned(9)])
    );

    let mut followed_by_plus = EQUALS_BRANCH.to_vec();
    followed_by_plus.push(PLUS);
    let mixed_pack = encode_pack(&followed_by_plus).expect("mixed pack fits");
    assert_eq!(
        execute_pack(&decode_pack(&mixed_pack).expect("mixed pack decodes")),
        Ok(vec![PyacValue::Unsigned(7), PyacValue::Unsigned(2)])
    );
}

#[test]
fn executes_a_pyash_comparison_branch_with_boolean_results() {
    let bytes = encode_pack(&TINY_BOOLEAN_BRANCH).expect("boolean branch pack fits");
    let result = execute_pack(&decode_pack(&bytes).expect("boolean branch pack decodes"));
    assert_eq!(result, Ok(vec![PyacValue::Boolean(true)]));

    let mut false_branch = TINY_BOOLEAN_BRANCH;
    false_branch[0][2] = 7;
    let bytes = encode_pack(&false_branch).expect("false boolean branch pack fits");
    let result = execute_pack(&decode_pack(&bytes).expect("false boolean branch pack decodes"));
    assert_eq!(result, Ok(vec![PyacValue::Boolean(false)]));
}

#[test]
fn conditional_pack_rejects_an_unimplemented_predicate_shape() {
    let mut unsupported = EQUALS_BRANCH;
    unsupported[0][7] = 0x8a64;
    let bytes = encode_pack(&unsupported).expect("pack fits");
    let error = execute_pack(&decode_pack(&bytes).expect("pack decodes"))
        .expect_err("arithmetic is not a conditional predicate");

    assert_eq!(error.index, 0);
    assert_eq!(error.code(), "malformed-branch");
}

fn vector_arithmetic(elements: &[u16], operand: u16, operator: u16) -> [u16; WORDS_PER_CODELET] {
    let explicit = !matches!(elements.len(), 2 | 3 | 4 | 8);
    let quote = match (elements.len(), explicit) {
        (2, _) => 0x891d,
        (3, _) => 0x8f1d,
        (4, _) => 0x8a1d,
        (8, _) => 0x8c1d,
        (_, true) => 0x8e1d,
        _ => unreachable!(),
    };
    let mut words = [0; WORDS_PER_CODELET];
    let mut offset = 1;
    words[offset] = quote;
    offset += 1;
    if explicit {
        words[offset] = elements.len() as u16;
        offset += 1;
    }
    words[offset..offset + elements.len()].copy_from_slice(elements);
    offset += elements.len();
    let accusative = offset;
    words[offset] = 0x245e;
    offset += 1;
    words[offset] = 0x881d;
    words[offset + 1] = operand;
    offset += 2;
    let case = offset;
    words[offset] = 0x243e;
    words[offset + 1] = operator;
    words[offset + 2] = 0x295e;
    let mood = offset + 2;
    words[0] = index_word(&[accusative, case, mood]);
    words
}

fn vector_vector_arithmetic(
    left: &[u16],
    right: &[u16],
    operator: u16,
    operand_case: u16,
) -> [u16; WORDS_PER_CODELET] {
    let quote = |length| match length {
        2 => 0x891d,
        3 => 0x8f1d,
        4 => 0x8a1d,
        _ => unreachable!(),
    };
    let mut words = [0; WORDS_PER_CODELET];
    let mut offset = 1;
    words[offset] = quote(left.len());
    offset += 1;
    words[offset..offset + left.len()].copy_from_slice(left);
    offset += left.len();
    let accusative = offset;
    words[offset] = 0x245e;
    offset += 1;
    words[offset] = quote(right.len());
    offset += 1;
    words[offset..offset + right.len()].copy_from_slice(right);
    offset += right.len();
    let case = offset;
    words[offset] = operand_case;
    words[offset + 1] = operator;
    words[offset + 2] = 0x295e;
    let mood = offset + 2;
    words[0] = index_word(&[accusative, case, mood]);
    words
}

#[test]
fn vector_arithmetic_executes_inline_quotes_and_preserves_element_width() {
    let plus = vector_arithmetic(&[1, 2, 3, 4], 2, 0x8a64);
    let saturated_plus = vector_arithmetic(&[u16::MAX, 3], 2, 0x8a64);
    let product = vector_arithmetic(&[u16::MAX, 3], u16::MAX, 0xec90);
    let explicit = vector_arithmetic(&[1, 2, 3, 4, 5], 1, 0xabd2);
    let bytes = encode_pack(&[plus, saturated_plus, product, explicit]).expect("vector pack fits");
    let pack = decode_pack(&bytes).expect("vector pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Vector(VectorElements::Numbers(vec![3, 4, 5, 6])),
            PyacValue::Vector(VectorElements::Numbers(vec![u16::MAX, 5])),
            PyacValue::Vector(VectorElements::Numbers32(vec![4_294_836_225, 196_605])),
            PyacValue::Vector(VectorElements::Numbers(vec![0, 1, 2, 3, 4])),
        ])
    );
}

#[test]
fn vector_arithmetic_division_by_zero_reports_its_pack_index() {
    let divide = vector_arithmetic(&[8, 9], 0, 0x8893);
    let bytes = encode_pack(&[divide]).expect("vector pack fits");
    let error = execute_pack(&decode_pack(&bytes).expect("vector pack decodes"))
        .expect_err("vector division by zero fails");
    assert_eq!(error.index, 0);
    assert_eq!(error.source, SemanticError::DivisionByZero);
}

#[test]
fn vector_vector_arithmetic_executes_existing_cases_elementwise() {
    let plus = vector_vector_arithmetic(&[1, 2, 3, 4], &[5, 6, 7, 8], 0x8a64, 0x243e);
    let multiply = vector_vector_arithmetic(&[3, 4], &[5, 6], 0xec90, 0x490f);
    let wide_product =
        vector_vector_arithmetic(&[u16::MAX, 3], &[u16::MAX, u16::MAX], 0xec90, 0x243e);
    let divide = vector_vector_arithmetic(&[8, 9], &[2, 3], 0x8893, 0x490f);
    let bytes =
        encode_pack(&[plus, multiply, wide_product, divide]).expect("vector-vector pack fits");
    let pack = decode_pack(&bytes).expect("vector-vector pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Vector(VectorElements::Numbers(vec![6, 8, 10, 12])),
            PyacValue::Vector(VectorElements::Numbers32(vec![15, 24])),
            PyacValue::Vector(VectorElements::Numbers32(vec![4_294_836_225, 196_605])),
            PyacValue::Vector(VectorElements::Numbers(vec![4, 3])),
        ])
    );
}

#[test]
fn vector_vector_arithmetic_rejects_different_widths() {
    let mismatch = vector_vector_arithmetic(&[1, 2], &[3, 4, 5], 0x8a64, 0x243e);
    let bytes = encode_pack(&[mismatch]).expect("mismatch codelet fits the pack");
    let error = execute_pack(&decode_pack(&bytes).expect("pack decodes"))
        .expect_err("unequal vector widths must fail");
    assert_eq!(error.index, 0);
    assert_eq!(
        error.source,
        SemanticError::VectorWidthMismatch { left: 2, right: 3 }
    );
}

#[test]
fn mixed_pack_preserves_semantic_errors_with_their_codelet_index() {
    let divide_by_zero = [
        0x0149, 0x881d, 8, 0x245e, 0x881d, 0, 0x243e, 0x8893, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];
    let bytes = encode_pack(&[PLUS, divide_by_zero]).expect("pack fits");
    let pack = decode_pack(&bytes).expect("pack decodes");

    let error = execute_pack(&pack).expect_err("division by zero fails");
    assert_eq!(error.index, 1);
    assert_eq!(error.source, SemanticError::DivisionByZero);
}

#[test]
fn boolean_composition_executes_nested_boolean_facts() {
    let not_truth = [
        0x02a9, 0x257e, 0x6909, 0x245e, 0x7271, 0x217e, 0x305e, 0x245e, 0x30de, 0x295e, 0, 0, 0, 0,
        0, 0,
    ];
    let and_truth_lie = [
        [
            0xab56, 0x257e, 0x6909, 0x245e, 0x7271, 0x217e, 0x305e, 0x245e, 0x257e, 0x680d, 0x245e,
            0x7271, 0x217e, 0x305e, 0x490f, 0x24be,
        ],
        [0x0003, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    let or_lie_truth = [
        [
            0xab56, 0x257e, 0x680d, 0x245e, 0x7271, 0x217e, 0x305e, 0x245e, 0x257e, 0x6909, 0x245e,
            0x7271, 0x217e, 0x305e, 0x490f, 0x263e,
        ],
        [0x0003, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];

    let not_pack = decode_pack(&encode_pack(&[not_truth]).expect("not pack encodes"))
        .expect("not pack decodes");
    assert_eq!(execute_pack(&not_pack), Ok(vec![PyacValue::Boolean(false)]));

    let and_pack = decode_pack(&encode_pack(&and_truth_lie).expect("and pack encodes"))
        .expect("and pack decodes");
    assert_eq!(execute_pack(&and_pack), Ok(vec![PyacValue::Boolean(false)]));

    let or_pack = decode_pack(&encode_pack(&or_lie_truth).expect("or pack encodes"))
        .expect("or pack decodes");
    assert_eq!(execute_pack(&or_pack), Ok(vec![PyacValue::Boolean(true)]));
}

#[test]
fn literal_comparisons_execute_as_boolean_pack_results() {
    let equally = [
        0x0149, 0x881d, 5, 0x24de, 0x881d, 5, 0x313e, 0x4809, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];
    let tiny = [
        0x0149, 0x881d, 4, 0x24de, 0x881d, 5, 0x313e, 0x6c0d, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];
    let not_unequal = [
        0x2a91, 0x257e, 0x881d, 5, 0x24de, 0x881d, 4, 0x313e, 0x4809, 0x295e, 0x305e, 0x245e,
        0x30de, 0x295e, 0, 0,
    ];

    for (codelet, expected) in [(equally, true), (tiny, true), (not_unequal, true)] {
        let bytes = encode_pack(&[codelet]).expect("comparison pack encodes");
        let pack = decode_pack(&bytes).expect("comparison pack decodes");
        assert_eq!(execute_pack(&pack), Ok(vec![PyacValue::Boolean(expected)]));
    }
}

#[test]
fn combined_boolean_sentences_keep_codelet_boundaries() {
    let not_truth = [
        0x02a9, 0x257e, 0x6909, 0x245e, 0x7271, 0x217e, 0x305e, 0x245e, 0x30de, 0x295e, 0, 0, 0, 0,
        0, 0,
    ];
    let equally = [
        0x0149, 0x881d, 5, 0x24de, 0x881d, 5, 0x313e, 0x4809, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];
    let not_unequal = [
        0x2a91, 0x257e, 0x881d, 5, 0x24de, 0x881d, 4, 0x313e, 0x4809, 0x295e, 0x305e, 0x245e,
        0x30de, 0x295e, 0, 0,
    ];
    let bytes = encode_pack(&[not_truth, equally, not_unequal]).expect("combined pack encodes");
    let pack = decode_pack(&bytes).expect("combined pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Boolean(false),
            PyacValue::Boolean(true),
            PyacValue::Boolean(true),
        ])
    );
}

#[test]
fn executes_independent_named_programlet_sections_and_preserves_hnuc_labels() {
    fn section_marker(name: u16, mood: u16) -> [u16; WORDS_PER_CODELET] {
        let mut codelet = [0; WORDS_PER_CODELET];
        codelet[0] = 0x0049;
        codelet[1..7].copy_from_slice(&[0x225e, name, 0x24de, 0xec01, 0x6a84, mood]);
        codelet
    }

    let mut second_programlet = LOCAL_NUMBER_PROGRAMLET;
    second_programlet[2][2] = 2;

    let mut codelets = Vec::new();
    for (name, programlet) in [
        (0xaa90, &LOCAL_NUMBER_PROGRAMLET),
        (0xa86a, &second_programlet),
    ] {
        codelets.push(section_marker(name, 0x5217));
        codelets.extend(*programlet);
        codelets.push(section_marker(name, 0x4e27));
    }
    let bytes = encode_pack(&codelets).expect("sectioned pack encodes");
    let pack = decode_pack(&bytes).expect("sectioned pack decodes");

    let sections = execute_pack_sections(&pack).expect("CPU shared runtime executes sections");
    assert_eq!(sections.len(), 2);
    let sections_by_index = sections
        .iter()
        .map(|section| (section.section_index, section))
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(
        sections_by_index.keys().copied().collect::<Vec<_>>(),
        vec![0, 1]
    );
    assert_eq!(sections_by_index.get(&0).unwrap().name_words, vec![0xaa90]);
    assert_eq!(sections_by_index.get(&1).unwrap().name_words, vec![0xa86a]);
    assert_eq!(
        sections_by_index.get(&0).unwrap().value,
        PyacValue::Unsigned(1)
    );
    assert_eq!(
        sections_by_index.get(&1).unwrap().value,
        PyacValue::Unsigned(2)
    );
    assert_eq!(
        execute_pack(&pack),
        Ok(vec![PyacValue::Unsigned(1), PyacValue::Unsigned(2)])
    );
}
