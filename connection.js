import 'dotenv/config';
import { ImapFlow } from 'imapflow';

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

const client = createImapClient();
await client.connect();
console.log("Inbox connected")

const lock = await client.getMailboxLock('INBOX');
console.log("Inbox lock acquired")

const uids = await client.search();
console.log("Inbox Emails found: " + uids.length)

