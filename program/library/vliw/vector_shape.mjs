export const MAX_VECTOR_ELEMENTS = 16;

export function expandVectorInitializer(
  type,
  values,
  declaredLength = null,
  maxElements = MAX_VECTOR_ELEMENTS
) {
  if (!Array.isArray(values)) throw new TypeError("vector values must be an array");
  if (declaredLength == null && values.length === 0) return [];
  const length = declaredLength == null ? values.length : Number(declaredLength);
  if (!Number.isInteger(length) || length < 1 || length > maxElements) {
    throw new RangeError(`vector width must be between 1 and ${maxElements}`);
  }
  if (values.length > length) {
    throw new RangeError("vector initializer has more values than its declared width");
  }
  if (type === "text") {
    if (values.length !== length) throw new RangeError("text vector width requires an explicit value for every element");
    return [...values];
  }
  if (declaredLength == null) {
    if (values.length === 0) throw new RangeError("vector width requires values or a declared length");
    return [...values];
  }
  const zero = type === "bool" ? "lie" : 0;
  if (values.length === 0) return Array(length).fill(zero);
  if (values.length === 1) return Array(length).fill(values[0]);
  return [...values, ...Array(length - values.length).fill(zero)];
}
