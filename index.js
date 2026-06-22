import 'dotenv/config';
import { pollEmails } from './Email_Polling/poll.js';

const POLL_AMOUNT = Number(process.env.POLL_AMOUNT || 1);

pollEmails(POLL_AMOUNT).catch(err => {
    console.error('[main] pollEmails failed:', err);
    process.exit(1);
});