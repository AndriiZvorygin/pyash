# `31-date-and-time.md` (draft v0.1)

This document defines date/time literals, duration units, and basic date math.

## 1. Date literals

Pyash uses the `date` type for time values.

- `ob date <ISO 8601>` is the canonical form.
- Date-only strings are allowed (for example `2025-01-20`).

Dynamic constants:
- `ob date today` resolves to the current day in the runtime time zone.
- `ob date now` resolves to the current timestamp in the runtime time zone.

Example:
```
ob date today be record ya
ob date now be record ya
```

## 2. Duration unit types

Durations are expressed using unit type tokens with numeric payloads.

Supported unit types:
- `second`
- `minute`
- `hour`
- `day`
- `week`
- `month`

Plural unit words (`seconds`, `minutes`, `hours`, `days`, `weeks`, `months`) are aliases.

Examples:
```
ob day 3 be record ya
ob hours 4 be record ya
ob month 1 be record ya
```

## 3. Date math with `add` / `subtract`

Adding a duration to a date produces a date.

Examples:
```
be add ob day 3 to date today do
be add ob hour 4 to date now do
be add ob weeks 3 to date today do
be add ob month 1 to date today do
```

Subtracting a duration from a date produces a date:
```
be subtract ob day 7 from date today do
be subtract ob month 1 from date today do
```

### 3.1 Result shape

- The result is a `date` literal in ISO 8601 form.
- Runtimes MUST apply the runtime time zone when resolving `today` and `now`.

## 4. Error behavior

- Unknown unit types MUST emit `be error ya`.
- Non-numeric unit payloads MUST emit `be error ya`.
