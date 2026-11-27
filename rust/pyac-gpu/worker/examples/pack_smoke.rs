use std::io::{self, Write};

use pyac::{WORDS_PER_CODELET, encode_pack, index_word};

fn scalar(left: u16, right: u16, case: u16, operator: u16) -> [u16; WORDS_PER_CODELET] {
    [
        0x0149, 0x881d, left, 0x245e, 0x881d, right, case, operator, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ]
}

fn conditional(left: u16, right: u16, operator: u16) -> [[u16; WORDS_PER_CODELET]; 2] {
    [
        [
            0xd6b6, 0x881d, left, 0x245e, 0x881d, right, 0x313e, operator, 0x29be, 0x881d, 7,
            0x245e, 0xea30, 0x217e, 0x881d, 9,
        ],
        [
            0x000b, 0x245e, 0xea30, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
    ]
}

fn boolean_conditional(left: u16, right: u16, operator: u16) -> [[u16; WORDS_PER_CODELET]; 2] {
    [
        [
            0xaab6, 0x881d, left, 0x245e, 0x881d, right, 0x313e, operator, 0x29be, 0x6909, 0x245e,
            0x7271, 0x217e, 0x680d, 0x245e, 0x7271,
        ],
        [0x0003, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]
}

fn main() {
    let invert = [
        0x0149, 0x881d, 5, 0x245e, 0x881d, 0, 0x207e, 0xaad2, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];
    let date = [
        0x00c1, 0x981d, 0x9c00, 0x8924, 0x0196, 0, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    let vector = [
        0x0061, 0x8f1d, 1, 2, 3, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    let mut vector_plus = [0; WORDS_PER_CODELET];
    vector_plus[1..12].copy_from_slice(&[
        0x8a1d, 1, 2, 3, 4, 0x245e, 0x881d, 2, 0x243e, 0x8a64, 0x295e,
    ]);
    vector_plus[0] = index_word(&[6, 9, 11]);

    let mut codelets = vec![
        scalar(1, 1, 0x243e, 0x8a64),
        scalar(9, 4, 0x243e, 0xabd2),
        scalar(8, 2, 0x243e, 0x8893),
        scalar(3, 4, 0x243e, 0x8c29),
        scalar(9, 4, 0x243e, 0xe82a),
        invert,
        date,
        vector,
        vector_plus,
        [
            0x0015, 0x6909, 0x245e, 0x7271, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        [
            0x0015, 0x680d, 0x245e, 0x7271, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
    ];
    codelets.extend_from_slice(&conditional(5, 5, 0x4809));
    codelets.extend_from_slice(&conditional(3, 5, 0x6c0d));
    codelets.extend_from_slice(&conditional(3, 5, 0x69b3));
    codelets.extend_from_slice(&boolean_conditional(3, 5, 0x6c0d));
    codelets.extend_from_slice(&[
        [
            0x0c05, 0x68b1, 0x24de, 0xd71d, 0, 0x3f80, 0, 0x4000, 0, 0x4040, 0x245e, 0x217e, 0, 0,
            0, 0,
        ],
        [
            0x0c05, 0x4930, 0x24de, 0xd71d, 0, 0x3f80, 0, 0x4000, 0, 0x4080, 0x245e, 0x217e, 0, 0,
            0, 0,
        ],
        [
            0x4909, 0x225e, 0x68b1, 0x245e, 0x225e, 0x327e, 0x225e, 0xaa90, 0x243e, 0x225e, 0x4930,
            0x287e, 0x2a64, 0x896a, 0x295e, 0,
        ],
    ]);

    let bytes = encode_pack(&codelets).expect("smoke pack encodes");
    io::stdout()
        .write_all(&bytes)
        .expect("smoke pack writes to stdout");
}
