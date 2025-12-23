# Errors

## 1. Purpose
Define the error sentence contract and canonical error names.

## 2. Terms
- error sentence: a `be error do` sentence thrown as an exception.

## 3. Rules (normative)
- Errors are thrown as exceptions with `err.sentence` set to a `be error do` sentence.
- Required fields:
  - `su name <error-name>`
  - `ob text <message>`
  - `from name <source>`
- Optional fields: `ob.pyash`, `ob.raw`.

## 4. Error contracts (stable names)
- `unknown verb`
- `signature mismatch`
- `signature derive`
- `exists invalid`
- `compile error`
- `variable as not exists`

## 5. Examples (existing files only)
- See: `quiz/exists_do.test.mjs`
- See: `quiz/ceremony_signature_mismatch.test.mjs`

## 6. Tests that define truth
- `quiz/exists_do.test.mjs`
- `quiz/ceremony_signature_mismatch.test.mjs`
