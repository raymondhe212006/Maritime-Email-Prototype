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

export async function pollEmail(targetSubject, number = 50, start = 0) {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    console.log("Inbox connected");

    function normalize(str = '') {
        return str.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    try {
        const uids = await client.search();
        console.log("Received Emails");

        if (uids.length === 0) {
            console.log('[imap] no emails found');
            return null;
        }

        const count = Math.min(number, uids.length);
        const normalizedTarget = normalize(targetSubject);

        for (let i = 0; i < count; i++) {
            const latestUid = uids[uids.length - i - 1 - start];

            const fullMessage = await client.fetchOne(latestUid, {
                uid: true,
                envelope: true,
                source: true,
            });

            const email = await parseEmail(fullMessage, fullMessage.source);

            if (DEBUG_LOGS) {
                console.log(`[imap] ${i + 1} Email ${email.subject}`);
            }

            const normalizedSubject = normalize(email.subject);

            if (normalizedSubject.includes(normalizedTarget)) {
                console.log("\n=== MATCHED EMAIL ===");
                console.log(`Subject: ${email.subject}`);
                console.log(`From: ${email.from || "unknown"}`);

                return email;
            }
        }

        console.log(`No email found matching subject: "${targetSubject}"`);
        return null;

    } finally {
        lock.release();
        await client.logout();
    }
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
