# Quantum Randomness and Evolutionary Computing

Research note: 2026-10-22

## Scope

This note records the evidence reviewed after the requirement was raised that
evolutionary workloads must consume direct quantum randomness rather than a
pseudorandom number generator (PRNG).

The requirement is valid as an experimental or domain policy: a pipeline may
choose to fail closed unless its random draws come from a quantum random
number generator (QRNG). It should not be described as a generally proven
optimization advantage without a matched benchmark for the target workload.

## Findings

- QRNG output is physically sourced and can provide non-deterministic bits.
  Practical QRNGs still require device assumptions, extraction or conditioning,
  health checks, and a trustworthy transport path. Self-testing QRNG protocols
  provide stronger provenance than a trusted-device QRNG. See [Quantum random
  number generation](https://arxiv.org/abs/1510.08957).
- The literature does not establish that quantum bits produce a general or
  guaranteed advantage for classical evolutionary programming.
- A molecular Monte Carlo comparison found that poor PRNGs deviated from the
  QRNG results, while Mersenne Twister and a 64-bit linear-congruential
  generator with a scrambler were statistically indistinguishable from the
  QRNG in the tested simulations. See [Ghersi, Parakh, and Mezei (2017)](https://pubmed.ncbi.nlm.nih.gov/28925088/).
- A genetic-algorithm study used ANU QRNG output for initialization, selection,
  crossover, and mutation in a pollution-routing problem. It compared the
  QRNG-based GA with tabu search, not with an otherwise identical PRNG-based
  GA; its tabu-search averages were better on nearly all reported instances.
  It therefore does not demonstrate a QRNG-over-PRNG advantage. See [A Genetic
  Algorithm with Quantum Random Number Generator](https://doi.org/10.3390/su13158381).
- A QRNG-versus-PRNG soft-computing study reported gains on some neural-network
  tasks, but also PRNG wins on random-tree and random-forest tasks and described
  some differences as minimal or indistinguishable. See [Bird, Ekárt, and Faria
  (2019)](https://arxiv.org/abs/1910.04701).
- A computational-creativity study reported a possible small benefit when
  quantum randomness was used about 15% of the time, with no benefit when it
  was used too often or too seldom. This is evidence for a task-specific
  effect, not a universal evolutionary-computing result. See [Iqbal
  (2020)](https://arxiv.org/abs/2008.11545).
- A theoretical and empirical study found that quantum and pseudorandom data
  can be indistinguishable under efficiently computable randomness measures
  when the quantum source is efficiently classically simulatable. This does
  not negate physical quantum randomness; it limits claims that an efficient
  classical workload must observe a performance difference. See [Indistinguishability
  between quantum randomness and pseudorandomness](https://doi.org/10.1103/PhysRevA.109.022243).

The defensible conclusion is: QRNG can matter for some sensitive stochastic
workloads, especially when a PRNG is poor, correlated, or otherwise mismatched
to the algorithm. A claim of a serious QRNG advantage should be demonstrated
with a controlled experiment rather than inferred from the physical origin of
the bits.

## Reported numerical differences

The clearest matched QRNG-versus-PRNG percentages found in the reviewed
literature were from a soft-computing study, not a pure evolutionary-programming
benchmark. The study used 25 PRNG and 25 QRNG runs per comparison:

| Task | PRNG | QRNG | Reported difference |
| --- | ---: | ---: | ---: |
| EEG classification mean | 63.84% | 66.45% | +2.61 percentage points, about +4.09% relative |
| EEG best result | 65.35% | 68.17% | +2.82 points, about +4.32% relative |
| CIFAR-10 best result | 74.43% | 75.35% | +0.92 points, about +1.24% relative |
| Accent classification mean | 98.73% | 98.80% | +0.07 points |
| Accent best result | 98.80% | 98.90% | +0.10 points |
| MNIST final best | 98.64% | 98.64% | 0 points |

These are classification-accuracy percentage points; the relative figures are
calculated against the PRNG result. The same study reported QRNG losses in
other models, including random-tree and random-forest comparisons. See [Bird,
Ekárt, and Faria (2019)](https://pure.aston.ac.uk/ws/portalfiles/portal/35518871/Bird2019_Article_OnTheEffectsOfPseudorandomAndQ.pdf).

For evolutionary algorithms specifically, the reviewed QRNG genetic-algorithm
paper did not report a valid QRNG-versus-PRNG percentage: it compared a
QRNG-based GA with tabu search instead. The computational-creativity study
reported fewer statistical outliers when QRNG was used for 15% of random
operations, but did not report a percentage improvement. See [A Genetic
Algorithm with Quantum Random Number Generator](https://doi.org/10.3390/su13158381)
and [The Effects of Quantum Randomness on a System Exhibiting Computational
Creativity](https://arxiv.org/abs/2008.11545).

## Direct-QRNG policy for Pyash experiments

If the workload policy rejects PRNG expansion, the implementation should use:

```text
QRNG device or authenticated QRNG service
    -> health-tested quantum bit stream
    -> unbiased range sampling
    -> evolutionary operators on the GPU
```

The GPU housekeeper may broker and buffer QRNG bytes, but it must not silently
replace them with `haveged`, `RDRAND`, `RDSEED`, or a PRNG. The job should fail
closed when the QRNG is unavailable or its health status is invalid.

Each run should preserve source identity, health-test result, byte/bit count,
retrieval time, and a verifiable receipt or signature where available. Mapping
bits to bounded integers should use rejection sampling rather than modulo
reduction so the mapping does not add bias. Entropy-source health testing and
min-entropy claims should be treated as an explicit source contract; see [NIST
SP 800-90B](https://csrc.nist.gov/pubs/sp/800/90/b/final).

For a QRNG-versus-PRNG research comparison, hold the algorithm, population,
evaluation budget, stopping rule, hardware, and data constant. Run enough
independent trials to report effect size and confidence intervals, not only the
best run. Record both the direct QRNG stream provenance and the complete
experiment outcome.

## Host observations from 2026-10-22

These are host inspections, not QRNG certifications:

- `mriczo`: bare-metal AMD Ryzen 5 5500GT; `RDSEED` and `RDRAND` CPU flags were
  present; `haveged` was active and enabled; Linux reported no registered
  `/dev/hwrng` provider (`rng_current: none`).
- `swac`: bare-metal AMD EPYC 7551P; `RDSEED` and `RDRAND` CPU flags were
  present; Linux reported `ccp-1-rng` through `ccp-8-rng`, with `ccp-1-rng`
  active. This appears to be the AMD CCP hardware-RNG path, not a quantum
  source.
- Neither host exposed a detected QRNG device or QRNG service during the
  inspection. The current SSH user could not directly read `/dev/hwrng` on
  either host; that does not by itself mean the kernel cannot use the device.

`haveged` is therefore not the deployment answer for a quantum-only policy.
It is a CPU-timing entropy source. A QRNG device or authenticated QRNG service
is required for the direct-quantum path.

## Related knowledge locations

- `documentation/index.md` is the documentation index.
- `documentation/reference/` contains durable technical references such as
  this note and the GPU housekeeper architecture.
- `documentation/decisions.md` contains architectural decisions and trade-offs.
- `documentation/agent-memory.md` describes durable agent-house memory.
- `skills/` contains operational playbooks; it is not the evidence library.
