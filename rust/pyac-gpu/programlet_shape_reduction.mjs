const SHAPES = new Map([
  ["call-depth", ["MAX_PROGRAMLET_CALL_DEPTH", 8]],
  ["local-slots", ["MAX_PROGRAMLET_LOCAL_SLOTS", 64]],
  ["arguments", ["MAX_PROGRAMLET_ARGUMENTS", 8]],
  ["vector-local-slots", ["MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS", 8]],
]);

export function replaceProgramletShape(source, shape, value) {
  const [constant, maximum] = SHAPES.get(shape) || [];
  if (!constant) throw new Error(`unknown programlet shape: ${shape}`);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${shape} diagnostic value must be an integer from 1 to ${maximum}`);
  }
  const pattern = new RegExp(`(pub const ${constant}: usize = |const ${constant}: usize = )(\\d+);`, "gu");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`expected one ${constant} definition; found ${matches.length}`);
  const original = matches[0][0];
  const replacement = `${matches[0][1]}${value};`;
  return {
    source: source.replace(pattern, replacement),
    original,
    replacement,
  };
}

export function listProgramletShapes() {
  return [...SHAPES.keys()];
}
