import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEmail } from '../Email_Polling/poll.js';
import { classify } from '../External_Calls/classifier.js';
import { saveClassifications, getShipmentsBySubject, deleteShipmentsBySubject, check_duplicate, purgeEmails } from '../Database/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS = path.join(__dirname, '..', 'Emails');

function readEml(name) {
    return fs.readFileSync(path.join(EMAILS, name));
}

const skipReason = !process.env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY not set';

describe('DB persistence via classify()', { skip: skipReason }, () => {
    test('A/C CHANG MYUNG PNW / SKOR email is saved to the DB', { timeout: 60000 }, async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('AC CHANG MYUNG PNW  SKOR 13 JUL,2026 ONWARDS .eml'));
        deleteShipmentsBySubject(email.subject);

        saveClassifications(await classify([email]));

        const rows = getShipmentsBySubject(email.subject);
        assert.ok(rows.length >= 1, `Expected at least 1 DB row, got ${rows.length}`);

        deleteShipmentsBySubject(email.subject);
    });

    test('9,500MT OR 5,000MT X 2 SHIPMENTS email produces 2–3 DB rows', { timeout: 60000 }, async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('9,500MT OR 5,000MT X 2 SHIPMENTS - SCRAP - EX VLADIVOSTOK TO INCHON.eml'));
        deleteShipmentsBySubject(email.subject);

        saveClassifications(await classify([email]));

        const rows = getShipmentsBySubject(email.subject);
        assert.ok(rows.length >= 2, `Expected at least 2 DB rows, got ${rows.length}`);
        assert.ok(rows.length <= 3, `Expected at most 3 DB rows, got ${rows.length}`);

        deleteShipmentsBySubject(email.subject);
    });

    test('NEED 28/42K email: saved on first run, duplicate blocked at polling phase on second', { timeout: 60000 }, async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('NEED 2842K - DEL TO MAKE AUSSIE.eml'));
        deleteShipmentsBySubject(email.subject);

        // first run: no duplicate, classify and save
        assert.ok(!check_duplicate(email.messageId), 'Should not be a duplicate before first classify');
        saveClassifications(await classify([email]));
        const rows = getShipmentsBySubject(email.subject);
        assert.ok(rows.length >= 1, `Expected at least 1 DB row after first classify, got ${rows.length}`);

        // second run: polling phase detects the duplicate and would skip the email
        assert.ok(check_duplicate(email.messageId), 'Should be detected as duplicate — polling phase would skip it');

        deleteShipmentsBySubject(email.subject);
    });

    test('OUR OPEN TONNAGE email (Jun 8) is saved then purged as older than 14 days', { timeout: 60000 }, async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('OUR OPEN TONNAGE .eml'));
        deleteShipmentsBySubject(email.subject);

        saveClassifications(await classify([email]));

        const rowsBefore = getShipmentsBySubject(email.subject);
        assert.ok(rowsBefore.length >= 1, `Expected at least 1 DB row after classify, got ${rowsBefore.length}`);

        purgeEmails();

        const rowsAfter = getShipmentsBySubject(email.subject);
        assert.strictEqual(rowsAfter.length, 0, `Expected 0 rows after purge, got ${rowsAfter.length}`);
    });
});
