import 'dotenv/config';
import { pollEmails } from './Email_Polling/poll.js';
import { classify } from './External_Calls/classifier.js';
import { saveClassifications } from './Database/db.js';


const POLL_BATCH_SIZE = Number(process.env.POLL_BATCH_SIZE || 50);
const POLL_TYPE = Number(process.env.POLL_TYPE || 0);
const POLL_0_DEBUG_START = Number(process.env.POLL_0_DEBUG_START || 0);
const POLL_TOTAL_AMO = Number(process.env.POLL_TOTAL_AMO || 100);
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';

if (DEBUG_LOGS) {
    console.log('[main] Starting email poll');
}

let totalPolled = 0;
let batchStart = POLL_0_DEBUG_START;

console.log("POLL_BATCH_SIZE: " + process.env.POLL_BATCH_SIZE)
console.log("POLL_TYPE: " + process.env.POLL_TYPE)
console.log("POLL_0_DEBUG_START: " + process.env.POLL_0_DEBUG_START)
console.log("POLL_TOTAL: " + process.env.POLL_TOTAL_AMO)
console.log("DEBUG_LOGS: " + process.env.DEBUG_LOGS)


while (totalPolled < POLL_TOTAL_AMO) {
    const batchSize = Math.min(POLL_BATCH_SIZE, POLL_TOTAL_AMO - totalPolled);
    console.log(`[main] Polling ${batchSize} emails`);
    const batch = await pollEmails(batchStart, batchSize, POLL_TYPE).catch(err => {
        console.error('[main] pollEmails failed:', err);
        process.exit(1);
    });

    if (batch.length === 0) break;

    console.log(`[main] classifying ${batch.length} emails`);
    const classified = await classify(batch).catch(err => {
        console.error('[main] classify failed:', err);
        process.exit(1);
    });

    console.log(`[main] Saving ${classified.length} emails`);
    try {
        saveClassifications(classified);
        console.log(`[main] Saved ${classified.length} emails`);
    } catch (err) {
        console.error('[main] saveClassifications failed:', err);
        process.exit(1);
    }

    totalPolled += batchSize;
    batchStart += batchSize;
}