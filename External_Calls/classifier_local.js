import OpenAI from 'openai';
import 'dotenv/config';
import { resolveVesselClass, findSizeClasses, laycan_patterns, getLaycanStartEnd } from '../Personalizations/patterns.js';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const client = new OpenAI({ baseURL: `${OLLAMA_HOST}/v1`, apiKey: 'ollama' });
const MODEL_FAST = process.env.OLLAMA_MODEL_FAST || 'qwen2.5:7b';
const MODEL_SMART = process.env.OLLAMA_MODEL_SMART || 'qwen2.5:72b';
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const LITE_DEBUG = process.env.LITE_DEBUG === 'true';
const DEBUG_PASS1 = process.env.DEBUG_PASS1 === 'true';
const CLASSIFY_FIRST_AMO = Number(process.env.CLASSIFY_FIRST_AMO || 50);
const CLASSIFY_SECOND_AMO = Number(process.env.CLASSIFY_SECOND_AMO || 5);
const CLASSIFY_THIRD_AMO = Number(process.env.CLASSIFY_THIRD_AMO || 50);

const FIRST_PASS_TEXT = `Classify emails as MARITIME or UNKNOWN. Output ONLY a JSON array — no text before or after, no markdown, no explanation.

"MARITIME" = ships, vessels, cargo, ports, tonnage, freight, chartering, laycan, DWT, bulk carrier
"UNKNOWN" = everything else

Example response for 3 emails: ["MARITIME","UNKNOWN","MARITIME"]

Start your response with [ and end with ]. Nothing else.`

const SECOND_PASS_TEXT = `Maritime classifier. Return ONLY a JSON array (no markdown): one elem per email, each elem an array of shipment objs.

Ex. 2 emails: [[{"t":"cargo","ton":{"r":"50K","min":48000,"max":52000,"u":"K","sc":null},"lp":"Rotterdam","dp":"Singapore","lc":"1-10 Jul","lcs":"2026-07-01","lce":"2026-07-10","itm":"Coal"}],[{"t":"vessel","ton":{"r":null,"min":null,"max":null,"u":null,"sc":"Panamax"},"lp":"Houston","dp":null,"lc":null,"lcs":null,"lce":null,"itm":"MV Ocean Star"}]]

t: cargo=charterer needs vessel, vessel=owner offers vessel, unknown=S&P/sale/spam/ambiguous. ton: r=raw text, min/max=MT int range, u=unit, sc=size class. lp/dp=load/discharge port. lc=laycan raw, lcs/lce=ISO start/end (for lc="D-D Month" both days share that month). itm: cargo type(cargo)/vessel name(vessel)/null(unknown). Null if absent elsewhere.`;

const THIRD_PASS_TEXT = 'Return a JSON array [[loadCountry,dischargeCountry],...] for each numbered port pair. "Unknown" if empty or unrecognizable. No markdown. Example: [["China","Singapore"],["Unknown","Netherlands"]]'

function stripMarkdown(str) {
    return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parse_first(result) {
    if (!Array.isArray(result)) return [];
    return result.map(v => (typeof v === 'string' && v.toUpperCase() === 'MARITIME') ? 'MARITIME' : 'UNKNOWN');
}

export async function First_Pass_Classifier(emails) {
    let userContent = "";
    for (let i = 0; i < emails.length; i++) {
        const preview = (emails[i].bodyText || '').slice(0, 100);
        userContent += `${i + 1}. Subject: ${emails[i].subject}\nBody: ${preview}\n\n`;
    }

    let raw;
    try {
        const msg = await client.chat.completions.create({
            model: MODEL_FAST,
            max_tokens: 10 * emails.length,
            temperature: 0,
            messages: [
                { role: 'system', content: FIRST_PASS_TEXT },
                { role: 'user', content: userContent },
            ],
        });
        raw = msg.choices[0].message.content.trim();
        return JSON.parse(stripMarkdown(raw));
    } catch (err) {
        console.error('[classifier] Pass 1 parse failure, passing all to Pass 2:', raw || err.message);
        return emails.map(() => 'MARITIME');
    }
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

export async function Second_Pass_Classifier(emails) {
    let userContent = "";
    for (let i = 0; i < emails.length; i++) {
        const subject = emails[i].subject || '';
        const preview = (emails[i].bodyText || '').slice(0, 4000);
        userContent += `${i + 1}. Subject: ${subject}\nBody:\n${preview}\n\n`;
    }

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
        const msg = await client.chat.completions.create({
            model: MODEL_SMART,
            max_tokens: Math.min(8192, 1024 * emails.length),
            temperature: 0,
            messages: [
                { role: 'system', content: SECOND_PASS_TEXT },
                { role: 'user', content: userContent },
            ],
        });
        raw = msg.choices[0].message.content.trim();
        const parsed = JSON.parse(stripMarkdown(raw));
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

export async function Third_Pass_Classifier(contents) {
    let userContent = "";
    for (let i = 0; i < contents.length; i++) {
        userContent += `${i + 1}. Load: ${contents[i].classifications.loadPort}\n Discharge: ${contents[i].classifications.dischargePort}\n\n`;
    }

    let raw;
    try {
        const msg = await client.chat.completions.create({
            model: MODEL_FAST,
            max_tokens: 25 * contents.length,
            temperature: 0,
            messages: [
                { role: 'system', content: THIRD_PASS_TEXT },
                { role: 'user', content: userContent },
            ],
        });
        raw = msg.choices[0].message.content.trim();
        return JSON.parse(stripMarkdown(raw));
    } catch (err) {
        console.error('[classifier] Pass 3 parse failure:', raw || err.message);
        return contents.map(() => 'UNKNOWN');
    }
}

export async function classify(emails) {
    let first_chunk = [];
    let second_pass_queue = [];
    for (let i = 0; i < emails.length; i++) {
        first_chunk.push(emails[i]);
        if ((i != 0 && i % CLASSIFY_FIRST_AMO === 0) || i == emails.length - 1) {
            if (DEBUG_LOGS) {
                console.log(`[classifier] First Pass: processing ${first_chunk.length} emails`);
                first_chunk.forEach((email, i) => {
                    console.log(`#${i + 1}: ${email.subject}`);
                });
            }
            const result = parse_first(await First_Pass_Classifier(first_chunk));
            if (DEBUG_LOGS) {
                console.log(result);
            }
            for (let j = 0; j < Math.min(result.length, first_chunk.length); j++) {
                if (result[j] === 'MARITIME') {
                    second_pass_queue.push(first_chunk[j]);
                }
            }
            first_chunk = [];
        }
    }

    if (DEBUG_PASS1 === true) {
        return null;
    }

    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`\n\nTotal Maritime Emails to classify: ${second_pass_queue.length}\n\n`);
    }

    let second_chunk = [];
    let third_pass_queue = []
    for (let i = 0; i < second_pass_queue.length; i++) {
        second_chunk.push(second_pass_queue[i]);

        if ((i != 0 && i % CLASSIFY_SECOND_AMO === 0) || i == second_pass_queue.length - 1) {
            if (DEBUG_LOGS) {
                console.log(`[classifier] Second Pass: processing ${second_chunk.length} emails`);
                second_chunk.forEach((email, i) => {
                    console.log(`#${i + 1}: ${email.subject}`);
                });
            }

            const result = parse_second(await Second_Pass_Classifier(second_chunk));

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
            second_chunk = [];

        }
    }


    if (DEBUG_LOGS || LITE_DEBUG) {
        console.log(`\n\n Classifying Ports from ${third_pass_queue.length} Entities\n\n`);
    }

    let thrid_chunk = []
    let db_queue = []
    for (let i = 0; i < third_pass_queue.length; i++) {
        thrid_chunk.push(third_pass_queue[i]);
        if ((i != 0 && i % CLASSIFY_THIRD_AMO === 0) || i == third_pass_queue.length - 1) {
            if (DEBUG_LOGS) {
                console.log(`[classifier] Third Pass: processing ${thrid_chunk.length} emails`);
                thrid_chunk.forEach((email, i) => {
                    console.log(`#${i + 1}: ${email.subject}`);
                });
            }
            const result = parse_third(await Third_Pass_Classifier(thrid_chunk));
            if (DEBUG_LOGS) {
                console.log(result);
            }
            for (let j = 0; j < Math.min(result.length, thrid_chunk.length); j++) {
                thrid_chunk[j].classifications.loadCountry = result[j][0]
                thrid_chunk[j].classifications.dischargeCountry = result[j][1]
                db_queue.push(thrid_chunk[j]);
            }
            thrid_chunk = [];
        }

    }

    return db_queue
}