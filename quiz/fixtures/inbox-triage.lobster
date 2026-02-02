name: inbox-triage
args:
  tag: "urgent"   # Optional filter
steps:
  - id: collect
    command: inbox list --unread --json   # Gets raw messages

  - id: categorize
    command: inbox categorize --json   # Adds tags/suggestions
    stdin: $collect.stdout

  - id: summarize_proposals
    command: llm-task --model gpt-4o --output-json   # Uses LLM to summarize nicely
    stdin: $categorize.stdout
    prompt: |
      Summarize the proposed inbox actions in a clear, bullet-point format for human approval.
      Include: number of messages, key actions (label/archive/reply), and any urgent items.
      Output JSON: {"summary": "Bullets here", "prompt": "Approve these changes?"}

  - id: approve
    command: approval.request --from-json   # Built-in helper that reads JSON and extracts prompt
    stdin: $summarize_proposals.stdout   # Passes the generated summary + prompt
    approval: required   # Pauses here; uses the custom "prompt" from stdin JSON

  - id: execute
    command: inbox apply --execute
    stdin: $categorize.stdout
    condition: $approve.approved
