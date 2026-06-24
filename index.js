import 'dotenv/config';
import { pollEmails } from './Email_Polling/poll.js';
import { classify } from './External_Calls/classifier.js';
import { saveClassifications } from './Database/db.js';


const POLL_BATCH_SIZE = Number(process.env.POLL_BATCH_SIZE || 50);
const POLL_TYPE = Number(process.env.POLL_TYPE || 0);
const POLL_0_DEBUG_START = Number(process.env.POLL_0_DEBUG_START || 0);
const POLL_TOTAL = Number(process.env.POLL_TOTAL || 100);
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';

if (DEBUG_LOGS) {
    console.log('[main] Starting email poll');
}

let totalPolled = 0;
let batchStart = POLL_0_DEBUG_START;

while (totalPolled < POLL_TOTAL) {
    const batchSize = Math.min(POLL_BATCH_SIZE, POLL_TOTAL - totalPolled);
    const batch = await pollEmails(batchStart, batchSize, POLL_TYPE).catch(err => {
        console.error('[main] pollEmails failed:', err);
        process.exit(1);
    });

    if (batch.length === 0) break;

    const classified = await classify(batch).catch(err => {
        console.error('[main] classify failed:', err);
        process.exit(1);
    });

    try {
        saveClassifications(classified);
    } catch (err) {
        console.error('[main] saveClassifications failed:', err);
        process.exit(1);
    }

    totalPolled += batchSize;
    batchStart += batchSize;
}