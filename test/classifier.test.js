import 'dotenv/config';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEmail } from '../Email_Polling/poll.js';
import { First_Pass_Classifier, Second_Pass_Classifier } from '../External_Calls/classifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS = path.join(__dirname, '..', 'Emails');

function readEml(name) {
    return fs.readFileSync(path.join(EMAILS, name));
}

const skipReason = !process.env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY not set';

describe('First_Pass_Classifier', { skip: skipReason }, () => {
    test('Storage Full spam → UNKNOWN', { timeout: 30000 }, async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('Storage Full- Update Your Account to Continue.eml'));
        const [result] = await First_Pass_Classifier([email]);
        assert.notStrictEqual(result?.toUpperCase(), 'MARITIME',
            `Expected UNKNOWN for a spam email, got: ${result}`);
    });
});

describe('Second_Pass_Classifier', { skip: skipReason }, () => {
    test('DWT 3,595 tn for sale → type unknown (S&P sale, not charter or vessel offer)', { timeout: 30000 }, async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('DWT 3,595 tn for sale.eml'));
        const [[classification]] = await Second_Pass_Classifier([email]);
        assert.strictEqual(classification.type, 'unknown',
            `Expected unknown for a vessel-for-sale email, got: ${classification.type}`);
    });

    test('RE: A/C GNS – INT.TABONEO / S.KOR → cargo (charterer fixing a vessel)', { timeout: 30000 }, async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('RE- AC GNS – INTTABONEO  SKOR.eml'));
        const [[classification]] = await Second_Pass_Classifier([email]);
        assert.strictEqual(classification.type, 'cargo',
            `Expected cargo (charterer seeking vessel), got: ${classification.type}`);
    });
});
