import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const LITE_DEBUG = process.env.LITE_DEBUG === 'true';
const DEBUG_PASS1 = process.env.DEBUG_PASS1 === 'true';
const CLASSIFY_FIRST_AMO = Number(process.env.CLASSIFY_FIRST_AMO || 50);
const CLASSIFY_SECOND_AMO = Number(process.env.CLASSIFY_SECOND_AMO || 5);



const FIRST_PASS_TEXT = 'Classify each numbered email as "MARITIME" (vessels, cargo) or "UNKNOWN". Return ONLY a JSON array in input order. No markdown. Example: ["MARITIME","UNKNOWN"]'

const SECOND_PASS_TEXT = `Maritime shipping classifier. Return ONLY a JSON array, one element per email in input order. Each element is an array of shipment objects. No markdown, no extra nesting.

Example for 2 emails: [[{"t":"cargo","ton":{"r":"50K","min":48000,"max":52000,"u":"K","sc":null},"lp":"Rotterdam","dp":"Singapore","lc":"1-10 Jul","lcs":"2026-07-01","lce":"2026-07-10","cgo":"Coal"}],[{"t":"shipping","ton":{"r":null,"min":null,"max":null,"u":null,"sc":"Panamax"},"lp":"Houston","dp":null,"lc":null,"lcs":null,"lce":null,"cgo":null}]]

Fields: t (cargo=charterer needs vessel; shipping=owner offers vessel; unknown=S&P/sale/spam/ambiguous), ton.r=tonnage as written, ton.min/max=MT integer range, ton.u=unit, ton.sc=size class, lp=loadPort, dp=dischargePort, lc=laycan as written, lcs/lce=ISO laycan start/end, cgo=cargo. Use null when absent.`;

function stripMarkdown(str) {
    return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function generateWithRetry(params, maxRetries = 4) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await client.models.generateContent(params);
        } catch (err) {
            const is429 = String(err?.message || err).includes('429') || String(err?.message || err).includes('RESOURCE_EXHAUSTED');
            if (is429 && attempt < maxRetries) {
                console.warn(`[classifier] Rate limited — retrying in 60s (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, 60000));
            } else {
                throw err;
            }
        }
    }
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
        const msg = await generateWithRetry({
            model: "gemini-2.5-flash",
            contents: [{ role: 'user', parts: [{ text: userContent }] }],
            config: {
                temperature: 0.2,
                maxOutputTokens: Math.max(256, 20 * emails.length),
                thinkingConfig: { thinkingBudget: 0 },
                systemInstruction: FIRST_PASS_TEXT,
            },
        });
        raw = msg.text.trim();
        return JSON.parse(stripMarkdown(raw));
    } catch (err) {
        console.error('[classifier] Pass 1 parse failure:', raw || err.message);
        return emails.map(() => 'UNKNOWN');
    }
}

function normalizeSecondPassResult(parsed) {
    const VALID_TYPES = ['cargo', 'shipping', 'unknown'];
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
        cargo: parsed.cgo ?? null,
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
        const msg = await generateWithRetry({
            model: "gemini-2.5-flash",
            contents: [{ role: 'user', parts: [{ text: userContent }] }],
            config: {
                temperature: 0.2,
                maxOutputTokens: Math.min(16384, 1536 * emails.length),
                thinkingConfig: { thinkingBudget: 512 },
                systemInstruction: SECOND_PASS_TEXT,
            },
        });
        raw = msg.text.trim();
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
    let db_queue = []
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
                const body_preview = second_chunk[i].bodyText.slice(0, 300);
                const company = '@' + second_chunk[i].from.split('@')[1];
                const date_sent = second_chunk[i].date
                for (let j = 0; j < result[i].length; j++) {
                    if (result[i][j].type != "unknown") {
                        if (result[i][j].tonnage.valueMin === result[i][j].tonnage.valueMax) {
                            result[i][j].tonnage.valueMin = Math.round(result[i][j].tonnage.valueMin * 0.95);
                            result[i][j].tonnage.valueMax = Math.round(result[i][j].tonnage.valueMax * 1.05);
                        }
                        db_queue.push({
                            message_id: message_id,
                            subject: subject,
                            body_preview: body_preview,
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

    return db_queue
}