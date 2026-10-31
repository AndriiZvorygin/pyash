function parseNumberToken(token) {
  const n = Number(token);
  return Number.isNaN(n) ? token : n;
}

export { parseNumberToken };
