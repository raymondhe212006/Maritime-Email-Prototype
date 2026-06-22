# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`maritime-email-matcher` — a Node.js service for Argo Oriental that polls an IMAP inbox, parses incoming emails, and uses Claude (via `@anthropic-ai/sdk`) to classify maritime shipping emails through a two-pass pipeline.

## Running

```bash
npm start        # or: node index.js
```

Requires a `.env` file (see `.env.example`). Copy `.env.example` to `.env` and fill in credentials before running.

## Architecture

The classification pipeline runs sequentially after all emails are fetched:

1. **`index.js`** — entry point; reads `POLL_AMOUNT`, calls `pollEmails(n)`.
2. **`Email_Polling/poll.js`** — connects to IMAP, fetches the `n` most recent emails (newest-first), parses each with `mailparser`, releases the lock, then runs the classification pipeline. Emails from senders whose address contains `"bulk"` are skipped before classification.
3. **`External_Calls/classifier.js`** — two Claude-based classifiers:
   - `First_Pass_Classifier(subject, bodyText)` — Haiku call; returns `"MARITIME"` or `"UNKNOWN"`.
   - `Second_Pass_Classifier(email)` — stub, not yet implemented; intended to classify MARITIME emails into finer-grained types.

The IMAP lock is released before classification begins — all emails are fetched first, then classified in a separate loop.

## Environment Variables

| Variable | Purpose |
|---|---|
| `IMAP_HOST/PORT/SECURE/USER/PASS` | IMAP mailbox credentials |
| `ANTHROPIC_API_KEY` | Claude API key |
| `POLL_AMOUNT` | Number of most-recent emails to fetch per run (default 1) |
| `DEBUG_LOGS` | Set to `true` to log each email subject and classifier result |
| `MATCH_THRESHOLD` | Confidence threshold for matching (default 60, reserved for future use) |
| `POLL_INTERVAL_MINUTES` | Intended polling interval if a scheduler is added (default 15) |
| `PORT` | HTTP server port if a web layer is added (default 3000) |
| `DB_RETENTION_DAYS` | Record retention duration if storage is added (default 30) |

## Key Notes

- ES modules throughout (`"type": "module"`) — use `import`/`export`, not `require`.
- `imapflow` holds a mailbox lock during fetch; always release it in a `finally` block.
- `First_Pass_Classifier` takes `(subject, bodyText)` as separate string arguments, not an email object. `Second_Pass_Classifier` takes the full parsed email object.
- The first-pass prompt instructs the model to return `{"type":"MARITIME"}` or `{"type":"UNKNOWN"}`. If the model returns a variant (e.g. `"SHIP"` or `"CARGO"`), `stripMarkdown` + JSON parse handles fence cleanup but type normalization is the caller's responsibility.
