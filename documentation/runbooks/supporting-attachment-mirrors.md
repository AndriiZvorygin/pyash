# Supporting attachment mirrors

Agenda and transcript publishers must not publish links to an official
attachment host unless a durable HelpOS copy has first been created. The
reporters retain item attachments beside `subreports.index.json` and retain
the full agenda package and cover in the meeting's `source` directory. The
shared mirror client uploads those exact bytes and rewrites both the post
Markdown and page HTML before publication.

The client defaults to:

`POST https://helpos.ca/api/helpos/v1/attachment-publish`

Set `ATTACHMENT_PUBLISH_ENDPOINT` only when the service is mounted elsewhere.
The request uses the same bearer token as agenda and meeting publishing.

## Request contract

The endpoint accepts `multipart/form-data` with:

- `metadata`: JSON containing `jurisdiction`, `body`, `date_iso`, `item`,
  `label`, `original_url`, `filename`, `content_type`, `size_bytes`, `sha256`,
  and `idempotency_key`
- `attachment`: the retained source file

The idempotency key is `attachment-${sha256}`. The service must verify the
uploaded byte count and SHA-256 digest, store the file by content hash, and
return an existing object for repeated uploads of the same hash.

A successful JSON response must include one of `mirror_url`,
`attachment_url`, `url`, or `attachment.url`. The preferred response is:

```json
{
  "mirror_url": "https://helpos.ca/attachments/<sha256>/<safe-filename>",
  "sha256": "<sha256>",
  "size_bytes": 12345,
  "idempotent_replay": false
}
```

## Server requirements

- Reuse the agenda/meeting publisher bearer-token authentication.
- Do not fetch `original_url`; accept only the uploaded bytes.
- Permit the required document formats (PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX,
  CSV, and plain text), verify file signatures where applicable, and reject
  executable or active HTML content.
- Sanitize the display filename and prevent path traversal.
- Deduplicate by SHA-256 and use immutable, content-addressed storage.
- Configure the reverse proxy and application for at least 50 MB per file.
- Serve a correct `Content-Type`, `X-Content-Type-Options: nosniff`, and
  `Cache-Control: public, max-age=31536000, immutable`.
- Use `Content-Disposition: inline` for PDF/plain text and `attachment` for
  office formats.

## Failure and retry behavior

The publisher builds a plan from canonical agenda attachment ownership plus
the explicitly retained agenda package/cover sources, and requires every
document to have a retained local file. In a real publish it uploads all
planned files before sending the agenda or transcript request.
Any missing local file, non-2xx mirror response, malformed response, or
incomplete URL rewrite aborts publication.

Successful responses are cached beside the payload in
`*.supporting-attachments.mirror.response.json`. A retry reuses entries with
the same SHA-256 and does not upload them again.

Dry-run publishing validates the complete local mirror plan but performs no
network upload.

## Deployment verification

After deploying the endpoint:

1. Run the publisher in UPDATE mode for the affected post.
2. Confirm the mirror response manifest contains every planned attachment.
3. Confirm the post Markdown and rendered agenda page contain no
   `filestream.ashx` attachment URLs.
4. Request every returned `mirror_url`; each must return 200 and the stored
   SHA-256 must match its manifest entry.
