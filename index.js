import 'dotenv/config';
import { pollEmails } from './Email_Polling/poll.js';
import { saveClassifications, purgeEmails } from './Database/db.js';
import { match } from './Matcher/matcher.js';


const POLL_BATCH_SIZE = Number(process.env.POLL_BATCH_SIZE || 50);
const POLL_TYPE = Number(process.env.POLL_TYPE || 0);
const POLL_0_DEBUG_START = Number(process.env.POLL_0_DEBUG_START || 0);
const POLL_TOTAL_AMO = Number(process.env.POLL_TOTAL_AMO || 100);
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const RUN_INTERVAL = Number(process.env.RUN_INTERVAL || 30);
const PURGE_INTERVAL = Number(process.env.PURGE_INTERVAL || 6);
const KEY_TYPE = Number(process.env.KEY_TYPE || 0);
let classify;
if (KEY_TYPE === 0) {
    const { classify: geminiClassify } = await import('./External_Calls/classifier_gemini.js');
    classify = geminiClassify;
} else if (KEY_TYPE === 1) {
    const { classify: anthropicClassify } = await import('./External_Calls/classifier.js');
    classify = anthropicClassify;
} else {
    console.error('[main] Invalid KEY_TYPE');
    process.exit(1);
}


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

if (POLL_TYPE === 0) {
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

        console.log(`[main] Saving ${classified.length} entities`);
        try {
            saveClassifications(classified);
            console.log(`[main] Saved ${classified.length} entities`);
        } catch (err) {
            console.error('[main] saveClassifications failed:', err);
            process.exit(1);
        }

        totalPolled += batchSize;
        batchStart += batchSize;
    }

}
else if (POLL_TYPE === 1 || POLL_TYPE === 2) {
    async function run() {
        const totalEmails = await pollEmails(-1, POLL_TOTAL_AMO, POLL_TYPE).catch(err => {
            console.error('[main] pollEmails failed:', err);
            process.exit(1);
        });

        let totalPolled = 0;
        while (totalPolled < totalEmails.length) {
            const batchSize = Math.min(POLL_BATCH_SIZE, totalEmails.length - totalPolled);
            console.log(`[main] Polling ${batchSize} emails`);
            const batch = totalEmails.slice(totalPolled, totalPolled + batchSize);
            if (batch.length === 0) break;

            console.log(`[main] classifying ${batch.length} emails`);
            const classified = await classify(batch).catch(err => {
                console.error('[main] classify failed:', err);
                process.exit(1);
            });

            console.log(`[main] Saving ${classified.length} entities`);
            try {
                saveClassifications(classified);
                console.log(`[main] Saved ${classified.length} entities`);
            } catch (err) {
                console.error('[main] saveClassifications failed:', err);
                process.exit(1);
            }

            totalPolled += batchSize;
            batchStart += batchSize;
        }

        console.log("[main] Running Matcher...");
        match();
        console.log("[main] Matcher finished");
    }

    // Active window is Beijing workday 8am-5pm, expressed in server-local time
    // (12h behind Beijing) as 8pm-5am on nights starting Sun/Mon/Tue/Wed/Thu.
    const isWithinPollingHours = () => {
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay(); // 0=Sun ... 6=Sat
        if (hour >= 20) return day >= 0 && day <= 4; // Sun-Thu evenings
        if (hour < 5) return day >= 1 && day <= 5; // Mon-Fri early mornings (prev night was Sun-Thu)
        return false;
    };

    // ms until the next window opens (next 8pm on a Sun/Mon/Tue/Wed/Thu)
    const msUntilNextWindow = () => {
        const now = new Date();
        for (let addDays = 0; addDays <= 7; addDays++) {
            const candidate = new Date(now);
            candidate.setDate(now.getDate() + addDays);
            candidate.setHours(20, 0, 0, 0);
            if (candidate <= now) continue;
            if (candidate.getDay() <= 4) return candidate.getTime() - now.getTime();
        }
        return 4 * 60 * 60 * 1000; // unreachable
    };

    const scheduleNext = () => {
        if (isWithinPollingHours()) {
            const nextPoll = new Date(Date.now() + RUN_INTERVAL * 60 * 1000);
            console.log(`[scheduler] within polling hours, Next poll: ${nextPoll.toString()}`);
            setTimeout(async () => { await run(); scheduleNext(); }, RUN_INTERVAL * 60 * 1000);

        } else {
            const untilWindow = msUntilNextWindow();
            const nextPoll = new Date(Date.now() + untilWindow + RUN_INTERVAL * 60 * 1000);
            console.log(`[scheduler] not within polling hours, Next poll: ${nextPoll.toString()}`);
            setTimeout(scheduleNext, untilWindow);
        }
    };

    run();
    scheduleNext();
    purgeEmails();
    const nextPurge = new Date(Date.now() + PURGE_INTERVAL * 60 * 60 * 1000);
    console.log(`[scheduler] Next Purege: ${nextPurge.toString()}`);
    setInterval(purgeEmails, PURGE_INTERVAL * 60 * 60 * 1000);

}
else {
    console.error('[main] Invalid POLL_TYPE');
    process.exit(1);
}

