import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { First_Pass_Classifier } from '../External_Calls/classifier.js';

const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';

const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: process.env.IMAP_SECURE,
    auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS,
    },
    tls: { rejectUnauthorized: false },
    logger: false
});

export async function pollEmails(number) {
    await client.connect();
    let lock = await client.getMailboxLock('INBOX');
    console.log("Inbox connected")

    const emails = [];

    try {
        // Get recent/unread emails
        const uids = await client.search();
        console.log("Recieved Emails")

        if (uids.length === 0) {
            console.log('[imap] no emails found');
            return;
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
            if (DEBUG_LOGS) {
                console.log(`[imap] ${i + 1} Email ${email.subject}`);
            }
            emails.push(email);
        }
    } finally {
        lock.release();
        await client.logout();
    }

    for (let i = 0; i < emails.length; i++) {
        if (emails[i].from.includes("bulk")) {
            continue;
        }
        const type = await First_Pass_Classifier(emails[i].subject, emails[i].bodyText);
        if (DEBUG_LOGS) {
            console.log(`[classifier]  ${type}: ${i + 1} Email ${emails[i].subject}`);
        }
        if (type === 'MARITIME') {
            const classification = await Second_Pass_Classifier(emails[i]);
            if (DEBUG_LOGS) {
                console.log(`[classifier]  ${classification}: ${i + 1} Email ${emails[i].subject}`);
            }
        }
    }

    return 0
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
