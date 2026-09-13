import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { check_duplicate } from '../Database/db.js';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const LITE_DEBUG = process.env.LITE_DEBUG === 'true';

const GMAIL_GET_DELAY_MS = Number(process.env.GMAIL_GET_DELAY_MS || 300);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Gmail's per-user quota is metered per minute, so backoff needs to reach a full
// minute by the last retry to reliably outlast the throttled window - a few
// seconds of exponential backoff isn't enough to guarantee the quota reset.
const GMAIL_QUOTA_BACKOFF_MS = [5000, 15000, 30000, 60000];

async function gmailGetWithBackoff(gmail, messageId) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'raw' });
        } catch (err) {
            const isQuotaError = err?.code === 403 && /Quota exceeded/i.test(err?.message || '');
            if (!isQuotaError || attempt >= GMAIL_QUOTA_BACKOFF_MS.length) throw err;
            const backoffMs = GMAIL_QUOTA_BACKOFF_MS[attempt];
            console.warn(`[api] quota hit, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${GMAIL_QUOTA_BACKOFF_MS.length})`);
            await sleep(backoffMs);
        }
    }
}


function createImapClient() {
    return new ImapFlow({
        host: process.env.IMAP_HOST,
        port: Number(process.env.IMAP_PORT || 993),
        secure: true,
        auth: {
            user: process.env.IMAP_USER,
            pass: process.env.IMAP_PASS,
        },
        tls: { rejectUnauthorized: true },
        logger: false
    });
}



export async function pollEmails(start, number, polltype) {
    const emails = [];
    if (polltype === 0) {
        //read from /Emails/*.eml
        const files = fs.readdirSync('Emails');
        const end = Math.min(start + number, files.length);
        for (let i = start; i < end; i++) {
            const file = files[i];
            const fullPath = `Emails/${file}`;
            const source = fs.readFileSync(fullPath);
            const email = await parseEmail({ uid: file }, source);

            if (email.from.includes("bulk@argo-oriental.com")) {
                if (DEBUG_LOGS || LITE_DEBUG) {
                    console.log("blacklist: " + email.subject);
                }
                continue;
            }
            if (check_duplicate(email.messageId)) {
                if (DEBUG_LOGS || LITE_DEBUG) {
                    console.log("duplicate: " + email.subject);
                }
                break;
            }

            if (DEBUG_LOGS) {
                console.log(`[imap] ${i + 1} Email ${email.subject}`);
            }
            emails.push(email);
        }
    }
    else if (polltype === 1) {
        const client = createImapClient();
        await client.connect();
        console.log("Inbox connected")

        try {
            const lock = await client.getMailboxLock('INBOX');

            try {
                // Get recent/unread emails
                const uids = await client.search();
                console.log("Recieved Emails")

                if (uids.length === 0) {
                    console.log('[imap] no emails found');
                    return emails;
                }

                const count = Math.min(number, uids.length);
                const targetSeqs = uids.slice(-count).reverse();

                const messagesBySeq = new Map();
                for await (const message of client.fetch(targetSeqs, {
                    uid: true,
                    envelope: true,
                    source: true,
                })) {
                    messagesBySeq.set(message.seq, message);
                }

                for (let i = 0; i < targetSeqs.length; i++) {
                    const fullMessage = messagesBySeq.get(targetSeqs[i]);
                    if (!fullMessage) continue;
                    const email = await parseEmail(fullMessage, fullMessage.source);

                    if (email.from.includes("bulk@argo-oriental.com")) {
                        if (DEBUG_LOGS || LITE_DEBUG) {
                            console.log("blacklist: " + email.subject);
                        }
                        continue;
                    }

                    if (check_duplicate(email.messageId)) {
                        if (DEBUG_LOGS || LITE_DEBUG) {
                            console.log("duplicate: " + email.subject);
                        }
                        break;
                    }

                    if (DEBUG_LOGS) {
                        console.log(`[imap] #${i + 1} Email ${email.subject}`);
                    }
                    emails.push(email);
                }
            } finally {
                lock.release();
            }
        } finally {
            try {
                await client.logout();
            } catch (err) {
                console.error('[imap] logout failed:', err.message);
            }
        }
    }
    else if (polltype === 2) {
        const credentialsRaw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
        const tokenRaw = fs.readFileSync(TOKEN_PATH, 'utf8');
        const credentials = JSON.parse(credentialsRaw);
        const token = JSON.parse(tokenRaw);

        const auth = new google.auth.OAuth2(
            credentials.installed.client_id,
            credentials.installed.client_secret,
            credentials.installed.redirect_uris[0]
        );
        auth.setCredentials(token);

        const gmail = google.gmail({ version: 'v1', auth });

        console.log("[api] Checking Inbox...");

        const res = await gmail.users.messages.list({ userId: 'me', maxResults: number, labelIds: ['INBOX'] });
        const messages = res.data.messages || [];

        console.log("[api] Emails found:", messages.length);

        for (const message of messages) {
            if (message !== messages[0]) await sleep(GMAIL_GET_DELAY_MS);
            const msg = await gmailGetWithBackoff(gmail, message.id);
            const raw = msg.data.raw;
            const email = await parseEmail(
                {
                    id: msg.id,
                    gmailId: msg.id,
                    threadId: msg.threadId ?? null,
                },
                Buffer.from(raw, 'base64')
            );

            if (email.from.includes("bulk@argo-oriental.com")) {
                if (DEBUG_LOGS || LITE_DEBUG) {
                    console.log("blacklist: " + email.subject);
                }
                continue;
            }

            if (check_duplicate(email.messageId)) {
                if (DEBUG_LOGS || LITE_DEBUG) {
                    console.log("duplicate: " + email.subject);
                }
                break;
            }

            if (DEBUG_LOGS) {
                console.log(`[api] Email: ${email.subject}`);
            }
            emails.push(email);

        }
    }

    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`\n\nTotal Emails to classify: ${emails.length}\n\n`);
    }
    return emails;
}

function stripHtml(html) {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|table)>/gi, '\n')
        .replace(/<\/td>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

export async function parseEmail(message, source) {
    const parsed = await simpleParser(source);

    const subject = parsed.subject || '(no subject)';
    const from = parsed.from?.text || '';
    const date = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

    // Prefer plain text body. If missing/whitespace-only, fall back to stripped HTML.
    const plainText = (parsed.text || '').trim();
    const bodyText = (plainText || stripHtml(parsed.html || ''))
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return {
        uid: message.uid,
        messageId: message.envelope?.messageId || parsed.messageId || `fallback-${message.uid}`,
        subject,
        from,
        date,
        bodyText,
    };
}
