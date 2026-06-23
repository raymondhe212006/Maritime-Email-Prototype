import 'dotenv/config';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEmail } from '../Email_Polling/poll.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS = path.join(__dirname, '..', 'Emails');

function readEml(name) {
    return fs.readFileSync(path.join(EMAILS, name));
}

function isFiltered(email) {
    return email.from.includes('bulk@argo-oriental.com') || email.from.includes('email@ibroker.world');
}

describe('pollEmails sender filter', () => {
    test('mt Jag Lokesh - LR2 Tanker is excluded (ibroker.world sender)', async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('mt Jag Lokesh - LR2 Tanker.eml'));
        assert.ok(isFiltered(email), `Expected email to be filtered, got from: ${email.from}`);
    });

    test('Maritime Match Report — 107 matches is excluded (bulk@argo-oriental.com sender)', async () => {
        const email = await parseEmail({ uid: 'test' }, readEml('Maritime Match Report — 107 matches above threshold.eml'));
        assert.ok(isFiltered(email), `Expected email to be filtered, got from: ${email.from}`);
    });
});
