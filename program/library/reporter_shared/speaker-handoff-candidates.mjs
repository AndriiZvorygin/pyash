const SPEAKER_LABEL = "SPEAKER[_ ]?[0-9A-Z]+";
const CIVIC_TITLE = "(?:Mayor|Deputy\\s+Mayor|Councillor|Councilor|Chair|Clerk|Director|Commissioner|Warden|Mr\\.?|Ms\\.?|Dr\\.?)";
const NAMED_CUE = `(?:${CIVIC_TITLE}\\s+[A-Z][A-Za-z'’.-]*(?:\\s+[A-Z][A-Za-z'’.-]*){0,3})`;

function sourceText(value = "") {
  return String(value || "").replace(/\r\n?/gu, "\n");
}

function hasAdjacentSpeakerCallout(value = "") {
  const text = sourceText(value);
  const explicitTitleCallout = new RegExp(
    `(?:^|\\n)\\s*${SPEAKER_LABEL}\\s*:\\s*${NAMED_CUE}[^.?!\\n]{0,100}[.?!]\\s*\\n\\s*${SPEAKER_LABEL}\\s*:`,
    "imu",
  );
  const explicitIntroduction = new RegExp(
    `(?:^|\\n)\\s*${SPEAKER_LABEL}\\s*:[^\\n]{0,260}\\b(?:introduc\\w*|welcom\\w*|invit\\w*|call(?:ing)?\\s+on|turn(?:ing)?\\s+(?:it\\s+)?over\\s+to|go(?:ing)?\\s+over\\s+to|hear\\s+from)\\b[^\\n]{0,180}${NAMED_CUE}[^\\n]*\\n\\s*${SPEAKER_LABEL}\\s*:`,
    "imu",
  );
  return explicitTitleCallout.test(text) || explicitIntroduction.test(text);
}

export function hasExplicitSpeakerHandoffCandidate(value = "") {
  return hasAdjacentSpeakerCallout(value);
}

export function hasExplicitSpeakerIntroductionHandoffCandidate(value = "") {
  const text = sourceText(value);
  const introduction = new RegExp(
    `(?:^|\\n)\\s*${SPEAKER_LABEL}\\s*:[^\\n]{0,260}\\b(?:introduc\\w*|welcom\\w*|bring(?:ing)?\\s+(?:in|up)|present(?:ing)?\\s+(?:the\\s+)?(?:next|following)|invit\\w*|call(?:ing)?\\s+on|turn(?:ing)?\\s+(?:it\\s+)?over\\s+to|go(?:ing)?\\s+over\\s+to)\\b[^\\n]{0,220}${NAMED_CUE}[^\\n]*\\n\\s*${SPEAKER_LABEL}\\s*:`,
    "imu",
  );
  return introduction.test(text);
}
