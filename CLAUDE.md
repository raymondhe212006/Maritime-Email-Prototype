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
   - `Second_Pass_Classifier(email)` — Sonnet call; classifies MARITIME emails into `"cargo"`, `"shipping"`, or `"unknown"` and extracts fields (tonnage, ports, laycan, cargo type, vessel type, confidence, reason).

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

## Database

The SQLite database is created automatically at `Database/maritime.db` on first run.

To reset it:

```bash
rm Database/maritime.db
```

The file is gitignored and will be recreated with an empty schema on the next run.

## Testing

After every code change, run `npm test` and iterate until all tests pass before considering the task done.

```bash
npm test
```

Tests live in `test/*.test.js` and use Node's built-in `node:test` module. Do not mark work complete if any test is failing.

## Deployment (Cloudflare Tunnel)

To make the local dashboard (`http://localhost:3000`, started via `npm run website`) reachable by people in China without owning a domain, use a Cloudflare **quick tunnel**:

```bash
brew install cloudflared      # macOS; see cloudflare docs for other platforms
cloudflared tunnel --url http://localhost:3000
```

This prints a public `https://<random-name>.trycloudflare.com` URL proxied through Cloudflare's edge network. Notes:

- The URL is randomly generated and changes every time the tunnel restarts — fine for quick sharing/testing, not a stable long-term link.
- No Cloudflare account, domain, or DNS setup required for this quick-tunnel mode.
- The tunnel only stays up while the `cloudflared` process is running; keep it running in the background (e.g. via `nohup`, `tmux`, or a system service) for continuous access.
- **China reachability isn't guaranteed.** Cloudflare's standard (non-China) edge network is intermittently throttled or blocked by the Great Firewall depending on region/ISP, and this can change over time. Test from an actual China-based network/VPN before relying on it. If it proves unreliable, the durable fix is Cloudflare's China Network (requires an ICP license and an Enterprise plan) or hosting on a CDN/provider with mainland presence.
- If you later register a domain and add it to Cloudflare, switch to a **named tunnel** (`cloudflared tunnel create <name>` + `cloudflared tunnel route dns <name> <hostname>`) for a permanent, stable URL instead of the random quick-tunnel one.

## Key Notes

- ES modules throughout (`"type": "module"`) — use `import`/`export`, not `require`.
- `imapflow` holds a mailbox lock during fetch; always release it in a `finally` block.
- `First_Pass_Classifier` takes `(subject, bodyText)` as separate string arguments, not an email object. `Second_Pass_Classifier` takes the full parsed email object.
- The first-pass prompt instructs the model to return `{"type":"MARITIME"}` or `{"type":"UNKNOWN"}`. If the model returns a variant (e.g. `"SHIP"` or `"CARGO"`), `stripMarkdown` + JSON parse handles fence cleanup but type normalization is the caller's responsibility.
