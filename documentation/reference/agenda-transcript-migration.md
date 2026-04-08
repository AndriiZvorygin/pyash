# Agenda/Transcript Migration Workflow

Meeting identity is:

- `jurisdiction`
- `body`
- `date_iso` (`YYYY-MM-DD`)
- optional `suffix`

Canonical URLs:

- Agenda page: `/agendas/<jurisdiction>/<body>/<date>`
- Transcript page: `/transcripts/<jurisdiction>/<body>/<date>`

## Publish Endpoints

- Agenda: `POST /api/helpos/v1/agenda-publish`
- Transcript: `POST /api/helpos/v1/meeting-publish`

## New Commands

- Publish agenda payload:

```bash
node /home/htaf/pyash/command/publish_agenda_to_helpos_from_payload.mjs <payload_json> [community_name] [idempotency_key] [post_ref]
```

- Migrate existing agenda post to agenda page (update-first):

```bash
node /home/htaf/pyash/command/migrate_existing_agenda_post_to_agenda_page.mjs <meeting_dir> [base_prefix] [post_ref] [dry_run]
```

The migration command:

1. loads meeting/payload identity
2. upgrades legacy agenda HTML to agenda canonical URL
3. injects transcript URL
4. updates payload with `agenda_url` + `transcript_url`
5. calls agenda publish in UPDATE mode when `post_ref` is provided

## Auto-Pick Behavior

`run_next_unposted_story` now tracks agenda/transcript posted state separately:

- `posted_agenda`
- `posted_transcript`

and accepts successful local `*.agenda-publish.response.json` as agenda-posted evidence.

## Cross-Linking

Agenda preview payloads now include both:

- `agenda_url`
- `transcript_url` (paired meeting identity)

Transcript rendering/payload now includes:

- agenda backlink (`/agendas/...`)
- transcript canonical (`/transcripts/...`)

This preserves one agenda item and one transcript item per meeting identity, while enabling update-first migration for historical agenda posts.

