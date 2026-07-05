import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getLaycanStartEnd } from '../Personalizations/patterns.js';

describe('getLaycanStartEnd', () => {
    test('"01 - 05 July otw" ignores trailing junk after the month', () => {
        const [start, end] = getLaycanStartEnd('01 - 05 July otw', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-01');
        assert.equal(end, '2026-07-05');
    });

    test('"01/05 July 2026" ignores a trailing year after the month (year comes from date_sent)', () => {
        const [start, end] = getLaycanStartEnd('01/05 July 2026', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-01');
        assert.equal(end, '2026-07-05');
    });

    test('"15-25 July" (no junk) resolves normally', () => {
        const [start, end] = getLaycanStartEnd('15-25 July', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-15');
        assert.equal(end, '2026-07-25');
    });

    test('a date more than a month before date_sent rolls forward to next year', () => {
        const [start, end] = getLaycanStartEnd('1-5 Jan', '2026-12-20T00:00:00.000Z');
        assert.equal(start, '2027-01-01');
        assert.equal(end, '2027-01-05');
    });

    test('"early July" resolves to the 1st-10th', () => {
        const [start, end] = getLaycanStartEnd('early July', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-01');
        assert.equal(end, '2026-07-10');
    });

    test('"mid July" resolves to the 11th-20th', () => {
        const [start, end] = getLaycanStartEnd('mid July', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-11');
        assert.equal(end, '2026-07-20');
    });

    test('"end July" resolves to the 21st-31st', () => {
        const [start, end] = getLaycanStartEnd('end July', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-21');
        assert.equal(end, '2026-07-31');
    });

    test('"End of July" (with "of") resolves the same as "end July"', () => {
        const [start, end] = getLaycanStartEnd('End of July', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-21');
        assert.equal(end, '2026-07-31');
    });

    test('arbitrary filler text between the keyword and month is accepted', () => {
        const [start, end] = getLaycanStartEnd('End, cargo ready sometime around July', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-21');
        assert.equal(end, '2026-07-31');
    });

    test('a laycan with no day-range or early/mid/end pattern returns undefined instead of throwing', () => {
        assert.equal(getLaycanStartEnd('sometime soon', '2026-07-02T00:00:00.000Z'), undefined);
    });

    test('day 31 is in bounds and resolves normally', () => {
        const [start, end] = getLaycanStartEnd('27-31 July', '2026-07-02T00:00:00.000Z');
        assert.equal(start, '2026-07-27');
        assert.equal(end, '2026-07-31');
    });

    test('a start day over 31 (e.g. misparsed as "45-50 July") returns undefined instead of overflowing into August', () => {
        assert.equal(getLaycanStartEnd('45-50 July', '2026-07-02T00:00:00.000Z'), undefined);
    });

    test('an end day over 31 also returns undefined, even when the start day is valid', () => {
        assert.equal(getLaycanStartEnd('25-45 July', '2026-07-02T00:00:00.000Z'), undefined);
    });
});
