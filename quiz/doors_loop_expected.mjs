export function doorsExpectedValues(count) {
  const values = Array(count).fill("lie");
  for (let i = 1; i * i <= count; i++) {
    values[i * i - 1] = "truth";
  }
  return values;
}

export function doorsExpectedLiteral(count) {
  return `ve bool ${doorsExpectedValues(count).join(" ")}`;
}
