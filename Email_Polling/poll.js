import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { check_duplicate } from '../Database/db.js';

const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const LITE_DEBUG = process.env.LITE_DEBUG === 'true';


const client = new ImapFlow({
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

            if (email.from.includes("bulk@argo-oriental.com") || email.from.includes("email@ibroker.world")) {
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

                if (email.from.includes("bulk@argo-oriental.com") || email.from.includes("email@ibroker.world")) {
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

export async function parseEmail(message, source) {
    const parsed = await simpleParser(source);

    const subject = parsed.subject || '(no subject)';
    const from = parsed.from?.text || '';
    const date = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

    // Prefer plain text body. If missing, fall back to stripped HTML-ish text.
    const bodyText = (parsed.text || '')
        .replace(/\r\n/g, '\n')
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
