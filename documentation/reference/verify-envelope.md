# Verify Envelope (Provisional)

Purpose: define a stable Pyash sentence envelope for `verify` results.

Status: provisional reference. Promote to normative spec after implementation is stable.

## Envelope shape

`verify` emits one `series`:

```pyash
su name verify produce exactly num <error_count> from filename "<source>" atmost num <sentence_count> vyah success|fail be series def
...
prah
```

Rules:
- `exactly num` is the number of surfaced verification errors in the series.
- `from filename` is the verified source path (or synthetic source for inline text).
- `atmost num` is the number of sentences checked.
- `vyah success` when `error_count` is `0`; otherwise `vyah fail`.

## Error entries

Each verification error is one surfaced error sentence:

```pyash
su name verify defective ob text "<error_code>: <human message>" from name verify by num <line> be error ya
```

Optional character position:

```pyash
su name verify defective ob text "<error_code>: <human message>" from name verify by num <line> at num <char_pos> be error ya
```

Rules:
- Use canonical surfaced error form: `be error ya`.
- `by num` is the 1-based source line number.
- `at num` is optional character position for line-local diagnostics.
- Keep `ob text` short, operator-readable, and stable enough for debugging.

## Examples

Failure:

```pyash
su name verify produce exactly num 2 from filename "/workplace/examples/bad.pya" atmost num 12 vyah fail be series def
su name verify defective ob text "mood_defective: sentence must end with a valid mood token" from name verify by num 3 be error ya
su name verify defective ob text "portable_defective: sentence is not portable canonical pyash" from name verify by num 8 at num 17 be error ya
prah
```

Success:

```pyash
su name verify produce exactly num 0 from filename "/workplace/examples/good.pya" atmost num 12 vyah success be series def
prah
```

