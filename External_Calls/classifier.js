import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import { resolveVesselClass, findSizeClasses, laycan_patterns, getLaycanStartEnd } from '../Personalizations/patterns.js';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const LITE_DEBUG = process.env.LITE_DEBUG === 'true';
const DEBUG_PASS1 = process.env.DEBUG_PASS1 === 'true';
const CLASSIFY_FIRST_AMO = Number(process.env.CLASSIFY_FIRST_AMO || 50);
const CLASSIFY_SECOND_AMO = Number(process.env.CLASSIFY_SECOND_AMO || 5);
const CLASSIFY_THIRD_AMO = Number(process.env.CLASSIFY_THIRD_AMO || 50);
// Batch API runs asynchronously at 50% cost. Set USE_BATCH_API=false to fall back to
// sequential synchronous calls when latency matters more than price. Read per call so
// tests and callers can flip it at runtime.
const useBatchApi = () => process.env.USE_BATCH_API !== 'false';
const BATCH_POLL_INTERVAL_MS = Number(process.env.BATCH_POLL_INTERVAL_MS || 15000);

const FIRST_PASS_TEXT = 'Classify each numbered email as "MARITIME" (vessels, cargo) or "UNKNOWN". Return ONLY a JSON array in input order. No markdown. Example: ["MARITIME","UNKNOWN"]'

const SECOND_PASS_TEXT = `Maritime classifier. Return ONLY a JSON array (no markdown): one elem per email, each elem an array of shipment objs.

Ex. 2 emails: [[{"t":"cargo","ton":{"r":"50K","min":48000,"max":52000,"u":"K","sc":null},"lp":"Rotterdam","dp":"Singapore","lc":"1-10 Jul","lcs":"2026-07-01","lce":"2026-07-10","itm":"Coal"}],[{"t":"vessel","ton":{"r":null,"min":null,"max":null,"u":null,"sc":"Panamax"},"lp":"Houston","dp":null,"lc":null,"lcs":null,"lce":null,"itm":"MV Ocean Star"}]]

t: cargo=charterer needs vessel, vessel=owner offers vessel, unknown=S&P/sale/spam/ambiguous. ton: r=raw text, min/max=MT int range, u=unit, sc=size class. lp/dp=load/discharge port. lc=laycan raw, lcs/lce=ISO start/end (for lc="D-D Month" both days share that month). itm: cargo type(cargo)/vessel name(vessel)/null(unknown). Null if absent elsewhere.`;

const THIRD_PASS_TEXT = 'Return a JSON array [[loadCountry,dischargeCountry],...] for each numbered port pair. "Unknown" if empty or unrecognizable. No markdown. Example: [["China","Singapore"],["Unknown","Netherlands"]]'

function stripMarkdown(str) {
    return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function messageText(message) {
    return message.content[0].text.trim();
}

function chunk(items, size) {
    const step = Math.max(1, size);
    const out = [];
    for (let i = 0; i < items.length; i += step) {
        out.push(items.slice(i, i + step));
    }
    return out;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Submits every chunk of a pass as one batch, waits for it to finish, and returns the
// messages in chunk order. Results come back in arbitrary order, so they are keyed by
// custom_id rather than by position.
async function runBatch(requests, label) {
    const batch = await client.messages.batches.create({ requests });
    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`[classifier] ${label}: submitted batch ${batch.id} (${requests.length} requests)`);
    }

    let status = batch;
    while (status.processing_status !== 'ended') {
        await sleep(BATCH_POLL_INTERVAL_MS);
        status = await client.messages.batches.retrieve(batch.id);
        if (DEBUG_LOGS) {
            console.log(`[classifier] ${label}: ${status.processing_status}, ${status.request_counts.processing} still processing`);
        }
    }

    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`[classifier] ${label}: ${status.request_counts.succeeded} succeeded, ${status.request_counts.errored} errored`);
    }

    const byId = new Map();
    for await (const entry of await client.messages.batches.results(batch.id)) {
        if (entry.result.type === 'succeeded') {
            byId.set(entry.custom_id, entry.result.message);
        } else {
            console.error(`[classifier] ${label}: ${entry.custom_id} ${entry.result.type}`);
            byId.set(entry.custom_id, null);
        }
    }
    return byId;
}

// Runs one pass over its chunks and returns an array of messages aligned with `chunks`.
// A null entry means that chunk has no usable response; the pass decoder turns it into
// that pass's fallback, so one bad chunk never takes down the run.
async function runPass(chunks, buildParams, label) {
    if (chunks.length === 0) return [];

    if (!useBatchApi()) {
        const messages = [];
        for (const items of chunks) {
            try {
                messages.push(await client.messages.create(buildParams(items)));
            } catch (err) {
                console.error(`[classifier] ${label} request failed:`, err.message);
                messages.push(null);
            }
        }
        return messages;
    }

    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const requests = chunks.map((items, i) => ({
        custom_id: `${slug}-${i}`,
        params: buildParams(items),
    }));

    try {
        const byId = await runBatch(requests, label);
        return requests.map(request => byId.get(request.custom_id) ?? null);
    } catch (err) {
        console.error(`[classifier] ${label} batch failed:`, err.message);
        return chunks.map(() => null);
    }
}

function parse_first(result) {
    if (!Array.isArray(result)) return [];
    return result.map(v => (typeof v === 'string' && v.toUpperCase() === 'MARITIME') ? 'MARITIME' : 'UNKNOWN');
}

function firstPassParams(emails) {
    let userContent = "";
    for (let i = 0; i < emails.length; i++) {
        const preview = (emails[i].bodyText || '').slice(0, 100);
        userContent += `${i + 1}. Subject: ${emails[i].subject}\nBody: ${preview}\n\n`;
    }

    return {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10 * emails.length,
        temperature: 0,
        system: FIRST_PASS_TEXT,
        messages: [{ role: 'user', content: userContent }],
    };
}

function decodeFirstPass(message, emails) {
    let raw;
    try {
        if (!message) throw new Error('no batch result');
        raw = messageText(message);
        return JSON.parse(stripMarkdown(raw));
    } catch (err) {
        console.error('[classifier] Pass 1 parse failure:', raw || err.message);
        return emails.map(() => 'UNKNOWN');
    }
}

export async function First_Pass_Classifier(emails) {
    let message = null;
    try {
        message = await client.messages.create(firstPassParams(emails));
    } catch (err) {
        console.error('[classifier] Pass 1 request failed:', err.message);
    }
    return decodeFirstPass(message, emails);
}

function normalizeSecondPassResult(parsed) {
    const VALID_TYPES = ['cargo', 'vessel', 'unknown'];
    const type = VALID_TYPES.includes(parsed.t) ? parsed.t : 'unknown';
    return {
        type,
        tonnage: {
            valueMin: typeof parsed.ton?.min === 'number' ? parsed.ton.min : null,
            valueMax: typeof parsed.ton?.max === 'number' ? parsed.ton.max : null,
            unit: parsed.ton?.u ?? null,
            raw: parsed.ton?.r ?? null,
            sizeClass: parsed.ton?.sc ?? null,
        },
        loadPort: parsed.lp ?? null,
        dischargePort: parsed.dp ?? null,
        laycan: parsed.lc ?? null,
        laycanStart: parsed.lcs ?? null,
        laycanEnd: parsed.lce ?? null,
        item: parsed.itm ?? null,
    };
}

function parse_second(result) {
    if (!Array.isArray(result)) return [];
    return result;
}

function secondPassParams(emails) {
    let userContent = "";
    for (let i = 0; i < emails.length; i++) {
        const subject = emails[i].subject || '';
        const preview = (emails[i].bodyText || '').slice(0, 4000);
        userContent += `${i + 1}. Subject: ${subject}\nBody:\n${preview}\n\n`;
    }

    return {
        model: 'claude-sonnet-4-6',
        // Sonnet 4.6 supports up to 128K output; the batch path submits every maritime
        // email as one request, so the old 8192 cap (sized for 5-email sync chunks) would
        // truncate output once a run turns up more than ~8 emails' worth of listings.
        max_tokens: Math.min(128000, 1024 * emails.length),
        temperature: 0,
        output_config: { effort: 'low' },
        system: SECOND_PASS_TEXT,
        messages: [{ role: 'user', content: userContent }],
    };
}

function decodeSecondPass(message, emails) {
    const fallback = emails.map(() => [{
        type: 'unknown',
        tonnage: { valueMin: null, valueMax: null, unit: null, raw: null, sizeClass: null },
        loadPort: null,
        dischargePort: null,
        laycan: null,
        laycanStart: null,
        laycanEnd: null,
        item: null,
    }]);

    let raw;
    try {
        if (!message) throw new Error('no batch result');
        raw = messageText(message);
        let stripped = stripMarkdown(raw);
        const parsed = JSON.parse(stripped);
        // With a single email in the batch there's no ambiguity about which email a listing
        // belongs to, so collapse one level in case the model returned one array per listing
        // (e.g. [[shipA],[shipB]]) instead of one array for the email (e.g. [[shipA,shipB]]).
        const items = emails.length === 1
            ? [(Array.isArray(parsed) ? parsed : [parsed]).flat()]
            : (Array.isArray(parsed) ? parsed : [parsed]);
        return items.map(emailResult => {
            let arr = Array.isArray(emailResult) ? emailResult : [emailResult];
            // flatten accidental extra nesting: [[{...}]] → [{...}]
            if (arr.length > 0 && Array.isArray(arr[0])) arr = arr[0];
            return arr.map(normalizeSecondPassResult);
        });
    } catch (err) {
        console.error('[classifier] Pass 2 parse failure:', raw || err.message);
        return fallback;
    }
}

export async function Second_Pass_Classifier(emails) {
    let message = null;
    try {
        message = await client.messages.create(secondPassParams(emails));
    } catch (err) {
        console.error('[classifier] Pass 2 request failed:', err.message);
    }
    return decodeSecondPass(message, emails);
}


export function correct(result, date_sent) {
    // Normalize Name and calculate standard min/max if needed
    const sizeClass = result.tonnage.sizeClass;
    let abs_min = 300000;
    let abs_max = -1;
    if (sizeClass) {
        let classes = "";
        let start = 0;
        for (let k = 0; k < sizeClass.length; k++) {
            if (sizeClass[k] === "/" || sizeClass[k] === "–" || sizeClass[k] === "-" || k == sizeClass.length - 1) {
                const vessel_class = resolveVesselClass(sizeClass.slice(start, k + 1 === sizeClass.length ? k + 1 : k));
                if (vessel_class) {
                    classes += vessel_class.name;
                    if (k != sizeClass.length - 1) {
                        classes += "/";
                    }
                    abs_min = Math.min(abs_min, vessel_class.min_dwt);
                    abs_max = Math.max(abs_max, vessel_class.max_dwt);
                    start = k + 1;
                }
            }
        }
        if (classes != "") {
            result.tonnage.sizeClass = classes;
        }
    }

    // If an int val is present, use it to fill in missing tonnage
    if (result.tonnage.valueMin != null && result.tonnage.valueMax === null) {
        result.tonnage.valueMax = result.tonnage.valueMin;
    }
    if (result.tonnage.valueMin === null && result.tonnage.valueMax != null) {
        result.tonnage.valueMin = result.tonnage.valueMax;
    }

    // Sometimes models miss the K suffix (10K → should be 10000)
    if (result.tonnage.valueMin != null && result.tonnage.valueMin < 1000) {
        result.tonnage.valueMin *= 1000;
    }
    if (result.tonnage.valueMax != null && result.tonnage.valueMax < 1000) {
        result.tonnage.valueMax *= 1000;
    }

    // set lenient range when a single point value was given
    if (result.tonnage.valueMin != null && result.tonnage.valueMax != null && result.tonnage.valueMin === result.tonnage.valueMax) {
        result.tonnage.valueMin = Math.round(result.tonnage.valueMin * 0.95);
        result.tonnage.valueMax = Math.round(result.tonnage.valueMax * 1.05);
    }

    if (result.tonnage.valueMin === null && result.tonnage.valueMax === null) {
        if (abs_min === 300000 && abs_max === -1) {
            result.tonnage.valueMin = 0;
            result.tonnage.valueMax = 300000;
        } else {
            result.tonnage.valueMin = abs_min;
            result.tonnage.valueMax = abs_max;
        }
    }

    if (!result.tonnage.sizeClass) {
        result.tonnage.sizeClass = findSizeClasses(result.tonnage.valueMin, result.tonnage.valueMax);
    }

    for (const pattern of laycan_patterns) {
        if (result.laycan != null && result.laycan.toLowerCase().includes(pattern)) {
            const start_date = new Date(date_sent);
            const end_date = new Date(date_sent);
            end_date.setDate(end_date.getDate() + 3);

            if (result.laycanStart === null) {
                result.laycanStart = start_date.toISOString().slice(0, 10);
            }
            if (result.laycanEnd === null) {
                result.laycanEnd = end_date.toISOString().slice(0, 10);
            }
            break;
        }
    }

    // Try to manually parse laycan raw text if model didn't
    if (result.laycanStart === null && result.laycanEnd === null && result.laycan != null && date_sent != null) {
        const resolved = getLaycanStartEnd(result.laycan, date_sent);
        if (resolved) {
            const [start, end] = resolved;
            result.laycanStart = start;
            result.laycanEnd = end;
        }
    }

    if (result.laycanEnd === null && result.laycanStart != null) {
        const end_date = new Date(result.laycanStart);
        end_date.setDate(end_date.getDate() + 7);
        result.laycanEnd = end_date.toISOString().slice(0, 10);
    }

}

function parse_third(result) {
    if (!Array.isArray(result)) return [];
    return result.map(entry => {
        if (!Array.isArray(entry) || entry.length < 2) return ['Unknown', 'Unknown'];
        return [
            typeof entry[0] === 'string' && entry[0].trim() ? entry[0].trim() : 'Unknown',
            typeof entry[1] === 'string' && entry[1].trim() ? entry[1].trim() : 'Unknown',
        ];
    });
}

function thirdPassParams(contents) {
    let userContent = "";
    for (let i = 0; i < contents.length; i++) {
        userContent += `${i + 1}. Load: ${contents[i].classifications.loadPort}\n Discharge: ${contents[i].classifications.dischargePort}\n\n`;
    }

    return {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 25 * contents.length,
        temperature: 0,
        system: THIRD_PASS_TEXT,
        messages: [{ role: 'user', content: userContent }],
    };
}

function decodeThirdPass(message, contents) {
    let raw;
    try {
        if (!message) throw new Error('no batch result');
        raw = messageText(message);
        return JSON.parse(stripMarkdown(raw));
    } catch (err) {
        console.error('[classifier] Pass 3 parse failure:', raw || err.message);
        return contents.map(() => 'UNKNOWN');
    }
}

export async function Third_Pass_Classifier(contents) {
    let message = null;
    try {
        message = await client.messages.create(thirdPassParams(contents));
    } catch (err) {
        console.error('[classifier] Pass 3 request failed:', err.message);
    }
    return decodeThirdPass(message, contents);
}

export async function classify(emails) {
    // The Batch API already submits every chunk of a pass as one batch, so splitting into
    // several chunks only buys anything on the sync fallback (keeps individual synchronous
    // requests small). Under the Batch API, send every item for a pass in a single request.
    const chunkForPass = (items, size) => useBatchApi() ? (items.length ? [items] : []) : chunk(items, size);

    const first_chunks = chunkForPass(emails, CLASSIFY_FIRST_AMO);
    if (DEBUG_LOGS) {
        console.log(`[classifier] First Pass: processing ${emails.length} emails in ${first_chunks.length} requests`);
        emails.forEach((email, i) => {
            console.log(`#${i + 1}: ${email.subject}`);
        });
    }
    const first_messages = await runPass(first_chunks, firstPassParams, 'Pass 1');

    const second_pass_queue = [];
    for (let c = 0; c < first_chunks.length; c++) {
        const first_chunk = first_chunks[c];
        const result = parse_first(decodeFirstPass(first_messages[c], first_chunk));
        if (DEBUG_LOGS) {
            console.log(result);
        }
        for (let j = 0; j < Math.min(result.length, first_chunk.length); j++) {
            if (result[j] === 'MARITIME') {
                second_pass_queue.push(first_chunk[j]);
            }
        }
    }

    if (DEBUG_PASS1 === true) {
        return null;
    }

    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`\n\nTotal Maritime Emails to classify: ${second_pass_queue.length}\n\n`);
    }

    const second_chunks = chunkForPass(second_pass_queue, CLASSIFY_SECOND_AMO);
    if (DEBUG_LOGS) {
        console.log(`[classifier] Second Pass: processing ${second_pass_queue.length} emails in ${second_chunks.length} requests`);
        second_pass_queue.forEach((email, i) => {
            console.log(`#${i + 1}: ${email.subject}`);
        });
    }
    const second_messages = await runPass(second_chunks, secondPassParams, 'Pass 2');

    const third_pass_queue = [];
    for (let c = 0; c < second_chunks.length; c++) {
        const second_chunk = second_chunks[c];
        const result = parse_second(decodeSecondPass(second_messages[c], second_chunk));

        for (let i = 0; i < Math.min(result.length, second_chunk.length); i++) {
            const message_id = second_chunk[i].messageId;
            const subject = second_chunk[i].subject;
            const body = second_chunk[i].bodyText;
            let company = '@' + second_chunk[i].from.split('@')[1];
            if (company[company.length - 1] === ">") {
                company = company.slice(0, -1);
            }
            const date_sent = second_chunk[i].date

            for (let j = 0; j < result[i].length; j++) {
                if (result[i][j].type != "unknown") {
                    correct(result[i][j], date_sent);

                    third_pass_queue.push({
                        message_id: message_id,
                        sub_id: j,
                        subject: subject,
                        body: body,
                        company: company,
                        time_sent: date_sent,
                        classifications: result[i][j],
                    });
                }
            }
        }
        if (DEBUG_LOGS) {
            console.log(JSON.stringify(result, null, 2));
        }
    }


    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`\n\n Classifying Ports from ${third_pass_queue.length} Entities\n\n`);
    }

    const third_chunks = chunkForPass(third_pass_queue, CLASSIFY_THIRD_AMO);
    if (DEBUG_LOGS) {
        console.log(`[classifier] Third Pass: processing ${third_pass_queue.length} entities in ${third_chunks.length} requests`);
        third_pass_queue.forEach((entity, i) => {
            console.log(`#${i + 1}: ${entity.subject}`);
        });
    }
    const third_messages = await runPass(third_chunks, thirdPassParams, 'Pass 3');

    const db_queue = []
    for (let c = 0; c < third_chunks.length; c++) {
        const third_chunk = third_chunks[c];
        const result = parse_third(decodeThirdPass(third_messages[c], third_chunk));
        if (DEBUG_LOGS) {
            console.log(result);
        }
        for (let j = 0; j < Math.min(result.length, third_chunk.length); j++) {
            third_chunk[j].classifications.loadCountry = result[j][0]
            third_chunk[j].classifications.dischargeCountry = result[j][1]
            db_queue.push(third_chunk[j]);
        }
    }

    return db_queue
}
