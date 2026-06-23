import Anthropic from '@anthropic-ai/sdk';
import { saveClassifications } from '../Database/db.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const DEBUG_PASS1 = process.env.DEBUG_PASS1 === 'true';
const CLASSIFY_FIRST_AMO = Number(process.env.CLASSIFY_FIRST_AMO || 10);
const CLASSIFY_SECOND_AMO = Number(process.env.CLASSIFY_SECOND_AMO || 10);


const FIRST_PASS_TEXT = 'Classify each numbered email as "MARITIME" (vessels, cargo) or "UNKNOWN". Return ONLY a JSON array in input order. No markdown. Example: ["MARITIME","UNKNOWN"]'

const SECOND_PASS_TEXT = `You are a maritime shipping classifier. Given numbered emails, return ONLY a JSON array — one element per email in input order. Each element is an array of shipment objects (one per distinct shipment/vessel in that email, or a single-element array if only one).

No markdown. Each shipment object has exactly: type, tonnage (raw/valueMin/valueMax/unit/sizeClass), loadPort, dischargePort, laycan, laycanStart, laycanEnd, cargo.

type: cargo=charterer needs vessel; shipping=owner offers vessel; unknown=S&P/sale/spam/ambiguous
tonnage.raw: exact string as written, null if absent
tonnage.valueMin/valueMax: inferred integer range in MT (e.g. "70K"→68000/72000; "Panamax"→60000/80000; "about 50K"→45000/55000); null only if nothing can be inferred
tonnage.unit: as written or null
tonnage.sizeClass: vessel size class or null
loadPort/dischargePort: port name or null
laycan: exact date range as written or null
laycanStart: inferred ISO date YYYY-MM-DD for start of laycan window, null if cannot determine
laycanEnd: inferred ISO date YYYY-MM-DD for end of laycan window, null if cannot determine
cargo: commodity type or null`;

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
        const msg = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 10 * emails.length,
            temperature: 0,
            system: FIRST_PASS_TEXT,
            messages: [{ role: 'user', content: userContent }],
        });
        raw = msg.content[0].text.trim();
        return JSON.parse(stripMarkdown(raw));
    } catch (err) {
        console.error('[classifier] Pass 1 parse failure:', raw || err.message);
        return emails.map(() => 'UNKNOWN');
    }
}

function normalizeSecondPassResult(parsed) {
    const VALID_TYPES = ['cargo', 'shipping', 'unknown'];
    const type = VALID_TYPES.includes(parsed.type) ? parsed.type : 'unknown';
    return {
        type,
        tonnage: {
            valueMin: typeof parsed.tonnage?.valueMin === 'number' ? parsed.tonnage.valueMin : null,
            valueMax: typeof parsed.tonnage?.valueMax === 'number' ? parsed.tonnage.valueMax : null,
            unit: parsed.tonnage?.unit ?? null,
            raw: parsed.tonnage?.raw ?? null,
            sizeClass: parsed.tonnage?.sizeClass ?? null,
        },
        loadPort: parsed.loadPort ?? null,
        dischargePort: parsed.dischargePort ?? null,
        laycan: parsed.laycan ?? null,
        laycanStart: parsed.laycanStart ?? null,
        laycanEnd: parsed.laycanEnd ?? null,
        cargo: parsed.cargo ?? null,
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
        cargo: null,
    }]);

    let raw;
    try {
        const msg = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: Math.min(8192, 1024 * emails.length),
            temperature: 0,
            output_config: { effort: 'low' },
            system: SECOND_PASS_TEXT,
            messages: [{ role: 'user', content: userContent }],
        });
        raw = msg.content[0].text.trim();
        const parsed = JSON.parse(stripMarkdown(raw));
        const items = Array.isArray(parsed) ? parsed : [parsed];
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
            for (let j = 0; j < result.length; j++) {
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

    if (DEBUG_LOGS) {
        console.log(`\n\nTotal Maritime Emails to classify: ${second_pass_queue.length}\n\n`);
    }

    let second_chunk = [];
    let email_company = [];
    let time_sent = [];
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
            if (DEBUG_LOGS) {
                console.log(JSON.stringify(result, null, 2));
            }
            second_chunk = [];
        }
    }
}