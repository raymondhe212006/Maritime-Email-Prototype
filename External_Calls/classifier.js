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

const SECOND_PASS_TEXT = `You are a maritime shipping classifier. Given an email, return ONLY a JSON array — one object per distinct shipment or vessel, or a single-element array if only one.

No markdown. Each object has exactly: type, tonnage (raw/valueMin/valueMax/unit/sizeClass), loadPort, dischargePort, laycan, cargo, confidence, reason.

type: cargo=charterer needs vessel; shipping=owner offers vessel; unknown=S&P/sale/spam/ambiguous
tonnage.raw: exact string as written, null if absent
tonnage.valueMin/valueMax: inferred integer range in MT (e.g. "70K" → 68000/72000; "Panamax" → 60000/80000; "about 50K" → 45000/55000); use context, vessel class, and cargo type to narrow the range; null only if no number or class can be inferred at all
tonnage.unit: as written or null
tonnage.sizeClass: vessel size class or null
loadPort/dischargePort: port name or null
laycan: exact date range as written or null
cargo: commodity type or null
confidence: integer 0-100
reason: under 15 words, no sender names or addresses`;

function stripMarkdown(str) {
    return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parse_first(result) {
    if (!Array.isArray(result)) return [];
    return result.map(v => (typeof v === 'string' && v.toUpperCase() === 'MARITIME') ? 'MARITIME' : 'UNKNOWN');
}

function normalizeSecondPassResult(parsed) {
    const VALID_TYPES = ['cargo', 'shipping', 'unknown'];
    const type = VALID_TYPES.includes(parsed.type) ? parsed.type : 'unknown';
    const rawTonnage = parsed.tonnage?.raw ?? null;
    return {
        type,
        tonnage: {
            valueMin: typeof parsed.tonnage?.valueMin === 'number' ? parsed.tonnage.valueMin : null,
            valueMax: typeof parsed.tonnage?.valueMax === 'number' ? parsed.tonnage.valueMax : null,
            unit: parsed.tonnage?.unit ?? null,
            raw: rawTonnage,
            sizeClass: parsed.tonnage?.sizeClass ?? null,
        },
        loadPort: parsed.loadPort ?? null,
        dischargePort: parsed.dischargePort ?? null,
        laycan: parsed.laycan ?? null,
        cargo: parsed.cargo ?? null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
        reason: parsed.reason ?? '',
    };
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

export async function Second_Pass_Classifier(email) {
    const subject = email.subject || '';
    const bodyText = email.bodyText || '';
    const preview = bodyText.slice(0, 4000);
    const userContent = `Subject: ${subject}\n\nEmail Body:\n${preview}`;

    const fallback = [{
        type: 'unknown',
        tonnage: { valueMin: null, valueMax: null, unit: null, raw: null, sizeClass: null },
        loadPort: null,
        dischargePort: null,
        laycan: null,
        cargo: null,
        confidence: 0,
        reason: 'parse failure',
    }];

    let raw;
    try {
        const msg = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            temperature: 0,
            output_config: { effort: 'low' },
            system: SECOND_PASS_TEXT,
            messages: [{ role: 'user', content: userContent }],
        });
        raw = msg.content[0].text.trim();
        const parsed = JSON.parse(stripMarkdown(raw));
        const items = Array.isArray(parsed) ? parsed : [parsed];
        return items.map(normalizeSecondPassResult);
    } catch (err) {
        console.error('[classifier] Pass 2 parse failure:', raw || err.message);
        return fallback;
    }
}

export async function classify(emails) {
    let first_chunk = []
    let second_pass_queue = []
    for (let i = 0; i < emails.length; i++) {
        first_chunk.push(emails[i])
        if ((i != 0 && i % CLASSIFY_FIRST_AMO === 0) || i == emails.length - 1) {
            if (DEBUG_LOGS) {
                console.log(`[classifier] First Pass: processing ${first_chunk.length} emails`);
                first_chunk.forEach((email, i) => {
                    console.log(`#${i + 1}: ${email.subject}`);
                });
            }
            const result = parse_first(await First_Pass_Classifier(first_chunk));
            if (DEBUG_LOGS) {
                console.log(result)
            }
            for (let j = 0; j < result.length; j++) {
                if (result[j] === 'MARITIME') {
                    second_pass_queue.push(first_chunk[j])
                }
            }
            first_chunk = []
        }
    }

    if (DEBUG_PASS1 === false) {
        if (type === 'MARITIME') {
            const classifications = await Second_Pass_Classifier(emails[i]);

            for (const classification of classifications) {
                if (DEBUG_LOGS) {
                    console.log('[classifier]', JSON.stringify(classification, null, 2));
                }
            }
        }
    }
}