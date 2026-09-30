# Print Audit

Pyash records local CUPS printing as append-only sentences under:

```text
/home/htaf/world/newspaper/YYYYMMDD-print.pya
```

## Commands

`~/bin/lp` is a transparent wrapper around `/usr/bin/lp`. It records file provenance before submission and fails closed when the journal cannot be written. Existing commands such as `trat` inherit auditing because they resolve `lp` through `PATH`.

The wrapper normalizes paper options to `media=Letter`, including requests that contain A4 or `media-col`, so audited command-line jobs always use US Letter.

Use the report command to review records:

```bash
print-audit
print-audit 2026-07-10
print-audit 2026-07
print-audit all
```

The report shows timestamp, user, copies, filename, source directory when available, printer, CUPS request ID, and final state.

Printer and cost profiles are stored outside the journal in `~/.config/pyash/printer-profiles.json`. Profiles are selected by physical UUID, serial number, sanitized device URI, and make/model before queue aliases are considered. Add a new effective profile version when costs change; historical jobs keep their original snapshot.

## Event Data

Each journal line is one `be print ya` sentence. Events can include:

- absolute and canonical source paths;
- source directories, byte sizes, and SHA-256 values;
- requested copies and original `lp` arguments;
- submitting user, printer, title, and CUPS request ID;
- CUPS state, reasons, impressions, sheets, media, sides, colour mode, and number-up.
- CUPS queue and server, make/model, UUID, serial, and sanitized device URI;
- stable printer profile and profile version;
- PDF page count and requested/completed impressions and physical sheets;
- snapshotted ink, paper, maintenance, electricity, and equipment-use assumptions;
- requested and final component costs, total estimated cost, and cost basis.

A four-page PDF printed two-up and duplex is recorded per copy as four document pages, two printed impressions, and one physical sheet. Copies, impressions, and sheets are not interchangeable.

The initial estimate uses `cost_basis=requested`. A terminal CUPS event uses `cost_basis=cups_completed` when final counters are available. Both estimates remain in the append-only event stream.

When CUPS reports successful completion but supplies no reliable counters, reports presume the requested copies and sheets completed and retain `cost_basis=requested`. Known jams, spoilage, partial output, cancellations, or other errors are recorded through append-only reconciliation.

## Manual Reconciliation

If CUPS never supplies a reliable terminal state, append a correction:

```bash
print-audit-reconcile EPSON_QUEUE-1234 --copies 18 --spoiled 2 --note "Two sheets jammed"
```

This adds confirmed copies, good completed sheets, spoiled sheets, reconciled cost, date, username, and note with `cost_basis=manually_reconciled`. It never modifies an earlier event.

The campaign-local report supports `--printer`, `--by-printer`, `--cost`, `--campaign`, and `--unreconciled`:

```bash
./print-history --printer epson-et-2980-home
./print-history --by-printer
./print-history --cost
./print-history --campaign mayor
./print-history --unreconciled
```

`program/library/print_audit/journal.mjs` exports the parser-backed append, read, and summary functions. `program/library/print_audit/cups.mjs` handles CUPS D-Bus and IPP data. `program/library/print_audit/lp.mjs` handles command-line provenance and submission.

## CUPS Monitor

`pyash-print-audit.service` runs as `htaf`, subscribes to CUPS job events, and reconciles recent jobs after restart. The installed unit is `/etc/systemd/system/pyash-print-audit.service`.

Command-line jobs retain exact paths and hashes. GUI applications normally provide only a CUPS job title, so their original source directory cannot be recovered.

Jobs submitted through `~/bin/lp` receive the richest requested-cost record. The CUPS monitor still adds physical-printer identity and final counters to GUI jobs where the server exposes them.
