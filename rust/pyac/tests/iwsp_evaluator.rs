use pyac::{
    IwspError, IwspEvaluator, IwspScore, PyacPack, SemanticError, WORDS_PER_CODELET, decode_pack,
    encode_pack,
};

fn float_literal(value: f32) -> [u16; WORDS_PER_CODELET] {
    let bits = value.to_bits();
    let mut codelet = [0; WORDS_PER_CODELET];
    codelet[0] = 0x0031;
    codelet[1] = 0xd01d;
    codelet[2] = bits as u16;
    codelet[3] = (bits >> 16) as u16;
    codelet[4] = 0x245e;
    codelet[5] = 0x217e;
    codelet
}

fn candidate(values: &[f32]) -> PyacPack {
    let codelets = values
        .iter()
        .copied()
        .map(float_literal)
        .collect::<Vec<_>>();
    decode_pack(&encode_pack(&codelets).expect("candidate pack encodes"))
        .expect("candidate pack decodes")
}

fn append_group(
    codelets: &mut Vec<[u16; WORDS_PER_CODELET]>,
    tokens: &[u32],
    boundaries: &[usize],
) {
    let count = tokens.len().div_ceil(WORDS_PER_CODELET - 1);
    for (index, chunk) in tokens.chunks(WORDS_PER_CODELET - 1).enumerate() {
        let complete = index + 1 == count;
        let start = index * (WORDS_PER_CODELET - 1);
        let mut codelet = [0; WORDS_PER_CODELET];
        codelet[0] = u16::from(complete);
        codelet[1..chunk.len() + 1]
            .copy_from_slice(&chunk.iter().map(|word| *word as u16).collect::<Vec<_>>());
        for (offset, _) in chunk.iter().enumerate() {
            if boundaries.contains(&(start + offset)) == complete {
                codelet[0] |= 1 << (offset + 1);
            }
        }
        codelets.push(codelet);
    }
}

fn append_named_f32(codelets: &mut Vec<[u16; WORDS_PER_CODELET]>, name: u32, values: [f32; 2]) {
    let mut tokens = vec![name, 0x24de, 0xd11d];
    for value in values {
        let bits = value.to_bits();
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
    let accusative = tokens.len();
    tokens.extend([0x245e, 0x217e]);
    append_group(codelets, &tokens, &[1, accusative, accusative + 1]);
}

fn dot_product(left: u32, right: u32) -> [u16; WORDS_PER_CODELET] {
    let tokens = [
        0x225e, left, 0x245e, 0x225e, right, 0x287e, 0x0d62, 0x8944, 0x295e,
    ];
    let mut codelet = [0; WORDS_PER_CODELET];
    codelet[0] = 0x0249;
    for (index, token) in tokens.iter().enumerate() {
        codelet[index + 1] = *token as u16;
    }
    codelet
}

fn linear_candidate(weights: [[f32; 2]; 3]) -> PyacPack {
    let mut codelets = Vec::new();
    append_named_f32(&mut codelets, 0x4123, [1.0, 2.0]);
    for (index, weight) in weights.into_iter().enumerate() {
        let name = [0x4567, 0x4890, 0x5111][index];
        append_named_f32(&mut codelets, name, weight);
    }
    for name in [0x4567, 0x4890, 0x5111] {
        codelets.push(dot_product(0x4123, name));
    }
    decode_pack(&encode_pack(&codelets).expect("linear candidate encodes"))
        .expect("linear candidate decodes")
}

#[test]
fn scores_candidate_outputs_with_the_trusted_pyash_judge() {
    let evaluator =
        IwspEvaluator::new(&[5.0, 4.0, 3.0], &[5.0, 4.0, 2.0]).expect("task references are valid");

    assert_eq!(
        evaluator.score_visible(&linear_candidate([[1.0, 2.0], [2.0, 1.0], [3.0, 0.0]])),
        Ok(IwspScore {
            correct: 3,
            total: 3
        })
    );
    assert_eq!(
        evaluator.score_visible_predictions(&[5.0, 4.0, 3.0]),
        Ok(IwspScore {
            correct: 3,
            total: 3
        })
    );
    assert_eq!(
        evaluator.score_visible(&linear_candidate([[1.0, 2.0], [2.0, 1.0], [2.0, 0.0]])),
        Ok(IwspScore {
            correct: 2,
            total: 3
        })
    );
}

#[test]
fn held_out_reference_is_available_only_through_a_consuming_sealed_evaluation() {
    let evaluator =
        IwspEvaluator::new(&[5.0, 4.0, 3.0], &[5.0, 4.0, 2.0]).expect("task references are valid");
    let candidate = linear_candidate([[1.0, 2.0], [2.0, 1.0], [2.0, 0.0]]);
    let sealed = evaluator.seal();

    assert_eq!(
        sealed.evaluate(&candidate),
        Ok(IwspScore {
            correct: 3,
            total: 3
        })
    );
}

#[test]
fn visible_feedback_is_independent_of_held_out_reference_values() {
    let candidate = linear_candidate([[1.0, 2.0], [2.0, 1.0], [3.0, 0.0]]);
    let first = IwspEvaluator::new(&[5.0, 4.0, 3.0], &[1.0, 1.0, 1.0])
        .expect("first task references are valid");
    let second = IwspEvaluator::new(&[5.0, 4.0, 3.0], &[5.0, 4.0, 2.0])
        .expect("second task references are valid");

    assert_eq!(
        first.score_visible(&candidate),
        second.score_visible(&candidate)
    );
}

#[test]
fn rejects_invalid_candidate_outputs_and_task_references_before_scoring() {
    let evaluator = IwspEvaluator::new(&[1.0], &[1.0]).expect("task references are valid");
    assert!(matches!(
        evaluator.score_visible(&candidate(&[f32::NAN])),
        Err(IwspError::CandidateExecution(error))
            if error.source == SemanticError::NonFiniteFloat
    ));
    assert!(matches!(
        evaluator.score_visible(&candidate(&[])),
        Err(IwspError::CandidateOutputCount { .. })
    ));
    let malformed = decode_pack(
        &encode_pack(&[[0; WORDS_PER_CODELET]]).expect("malformed pack envelope encodes"),
    )
    .expect("malformed codelet pack envelope decodes");
    assert!(matches!(
        evaluator.score_visible(&malformed),
        Err(IwspError::CandidateExecution(_))
    ));
    assert!(matches!(
        evaluator.score_visible_predictions(&[f32::INFINITY]),
        Err(IwspError::CandidateNonFinite { index: 0 })
    ));
    assert!(matches!(
        IwspEvaluator::new(&[], &[1.0]),
        Err(IwspError::InvalidReferenceWidth)
    ));
    assert!(matches!(
        IwspEvaluator::new(&[1.0], &[f32::INFINITY]),
        Err(IwspError::ReferenceNonFinite { index: 0 })
    ));
    assert!(matches!(
        IwspEvaluator::new(&[1.0, 2.0, 3.0, 4.0, 5.0], &[1.0, 2.0, 3.0, 4.0, 5.0]),
        Err(IwspError::InvalidReferenceWidth)
    ));
}

#[test]
fn scores_candidate_packs_longer_than_sixty_four_codelets() {
    let evaluator =
        IwspEvaluator::new(&[1.0, 1.0], &[1.0, 1.0]).expect("task references are valid");
    let pack = candidate(&vec![1.0; 80]);

    assert_eq!(pack.codelets.len(), 80);
    assert_eq!(
        evaluator.score_visible(&pack),
        Ok(IwspScore {
            correct: 2,
            total: 2
        })
    );
}
