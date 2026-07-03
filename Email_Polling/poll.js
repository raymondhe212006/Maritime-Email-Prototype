import fs from 'fs';
import 'dotenv/config';

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { check_duplicate } from '../Database/db.js';

const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const LITE_DEBUG = process.env.LITE_DEBUG === 'true';


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
        let lock = await client.getMailboxLock('INBOX');
        console.log("Inbox connected")

        try {
            // Get recent/unread emails
            const uids = await client.search();
            console.log("Recieved Emails")

            if (uids.length === 0) {
                console.log('[imap] no emails found');
                return emails;
            }

            const count = Math.min(number, uids.length);
            for (let i = 0; i < count; i++) {
                const latestUid = uids[uids.length - i - 1];
                const fullMessage = await client.fetchOne(latestUid, {
                    uid: true,
                    envelope: true,
                    source: true,
                });
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
            await client.logout();
        }
    }

    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`\n\nTotal Emails to classify: ${emails.length}\n\n`);
    }
    return emails
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
