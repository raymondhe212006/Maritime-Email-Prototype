import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { correct } from '../External_Calls/classifier.js';

function classification(tonnage) {
    return {
        type: 'cargo',
        tonnage: { valueMin: null, valueMax: null, unit: null, raw: null, sizeClass: null, ...tonnage },
        loadPort: null,
        dischargePort: null,
        laycan: null,
        laycanStart: null,
        laycanEnd: null,
        item: null,
    };
}

describe('correct — sizeClass combos', () => {
    test('Handymax/Supramax/Ultramax combines into the full span', () => {
        const c = classification({ sizeClass: 'Handymax/Supramax/Ultramax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handymax/Supramax/Ultramax');
        assert.equal(c.tonnage.valueMin, 40000);
        assert.equal(c.tonnage.valueMax, 65999);
    });

    test('Handy/Supra standardizes to Handysize/Supramax', () => {
        const c = classification({ sizeClass: 'Handy/Supra' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handysize/Supramax');
        assert.equal(c.tonnage.valueMin, 20000);
        assert.equal(c.tonnage.valueMax, 59999);
    });

    test('Handysize-Supramax standardizes the same as the slash form', () => {
        const c = classification({ sizeClass: 'Handysize-Supramax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handysize/Supramax');
        assert.equal(c.tonnage.valueMin, 20000);
        assert.equal(c.tonnage.valueMax, 59999);
    });

    test('Large-Handy-Supra keeps "Large" attached to Handy instead of splitting on every hyphen', () => {
        const c = classification({ sizeClass: 'Large-Handy-Supra' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Large Handysize/Supramax');
        assert.equal(c.tonnage.valueMin, 35000);
        assert.equal(c.tonnage.valueMax, 59999);
    });
});

describe('correct — regression: single class used to get truncated by 1 char', () => {
    test('a single class with no delimiter resolves fully (was "Panama" before the off-by-one fix)', () => {
        const c = classification({ sizeClass: 'Panamax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Panamax');
        assert.equal(c.tonnage.valueMin, 70000);
        assert.equal(c.tonnage.valueMax, 79999);
    });

    test('a single class as the last segment of a combo also resolves fully', () => {
        const c = classification({ sizeClass: 'Kamsarmax/Panamax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Kamsarmax/Panamax');
        assert.equal(c.tonnage.valueMin, 70000);
        assert.equal(c.tonnage.valueMax, 89999);
    });
});

describe('correct — case sensitivity', () => {
    test('lowercase input still resolves and is standardized to canonical casing', () => {
        const c = classification({ sizeClass: 'panamax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Panamax');
    });

    test('mixed-case combo resolves', () => {
        const c = classification({ sizeClass: 'handy/SUPRA' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handysize/Supramax');
    });
});

describe('correct — sizeClass no-match / missing', () => {
    test('no sizeClass and no numeric tonnage falls back to the wide 0-300000 default', () => {
        const c = classification({});
        correct(c);
        assert.equal(c.tonnage.valueMin, 0);
        assert.equal(c.tonnage.valueMax, 300000);
    });

    test('a completely unresolvable sizeClass string is left unchanged, range falls back to 0-300000', () => {
        const c = classification({ sizeClass: 'Imabari 61' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Imabari 61', 'nothing resolved, so the raw string is preserved as-is');
        assert.equal(c.tonnage.valueMin, 0);
        assert.equal(c.tonnage.valueMax, 300000);
    });
});

describe('correct — tonnage fill-in / lenient-range behavior', () => {
    test('valueMax fills in from valueMin, then both get widened by the lenient-range step', () => {
        const c = classification({ valueMin: 50000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, Math.round(50000 * 0.95));
        assert.equal(c.tonnage.valueMax, Math.round(50000 * 1.05));
    });

    test('valueMin fills in from valueMax, then both get widened by the lenient-range step', () => {
        const c = classification({ valueMax: 50000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, Math.round(50000 * 0.95));
        assert.equal(c.tonnage.valueMax, Math.round(50000 * 1.05));
    });

    test('a real range (min != max) is left untouched by the lenient-range widening', () => {
        const c = classification({ valueMin: 48000, valueMax: 52000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, 48000);
        assert.equal(c.tonnage.valueMax, 52000);
    });

    test('a sizeClass-derived fallback range is used when no numeric tonnage was extracted at all', () => {
        const c = classification({ sizeClass: 'Capesize' });
        correct(c);
        assert.equal(c.tonnage.valueMin, 130000);
        assert.equal(c.tonnage.valueMax, 189999);
    });
});

describe('correct — K-suffix fix (10K misread as 10)', () => {
    test('valueMax under 1000 is scaled by 1000, then lenient-range widens the now-equal min/max', () => {
        const c = classification({ valueMin: 10000, valueMax: 10 });
        correct(c);
        assert.equal(c.tonnage.valueMin, Math.round(10000 * 0.95));
        assert.equal(c.tonnage.valueMax, Math.round(10000 * 1.05));
    });

    test('valueMin under 1000 is scaled by 1000', () => {
        const c = classification({ valueMin: 10, valueMax: 20000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, 10000);
        assert.equal(c.tonnage.valueMax, 20000);
    });
});

describe('correct — known edge cases / current limitations in the sizeClass parser', () => {
    test('KNOWN LIMITATION: an unresolvable segment poisons a valid segment later in the same string', () => {
        // "Foo" never resolves, and because the scan window only grows (never resets)
        // until something matches, "Foo/Panamax" as a whole never matches any single
        // alias either — so "Panamax" is silently lost even though it's valid on its own.
        const c = classification({ sizeClass: 'Foo/Panamax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Foo/Panamax');
        assert.equal(c.tonnage.valueMin, 0);
        assert.equal(c.tonnage.valueMax, 300000);
    });

    test('KNOWN LIMITATION: a trailing delimiter breaks resolution of the final segment', () => {
        const c = classification({ sizeClass: 'Panamax/' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Panamax/');
        assert.equal(c.tonnage.valueMin, 0);
        assert.equal(c.tonnage.valueMax, 300000);
    });

    test('KNOWN LIMITATION: a leading delimiter breaks resolution entirely', () => {
        const c = classification({ sizeClass: '/Panamax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, '/Panamax');
        assert.equal(c.tonnage.valueMin, 0);
        assert.equal(c.tonnage.valueMax, 300000);
    });

    test('KNOWN LIMITATION: repeated aliases for the same class are not deduplicated', () => {
        const c = classification({ sizeClass: 'Handy/Handysize' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handysize/Handysize');
        assert.equal(c.tonnage.valueMin, 20000);
        assert.equal(c.tonnage.valueMax, 39999);
    });
});

describe('correct — numeric tonnage takes priority over the sizeClass-derived range', () => {
    test('a full numeric range is left untouched even when sizeClass also resolves', () => {
        const c = classification({ sizeClass: 'Panamax', valueMin: 72000, valueMax: 75000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Panamax');
        assert.equal(c.tonnage.valueMin, 72000);
        assert.equal(c.tonnage.valueMax, 75000);
    });

    test('a partial numeric value fills in from itself, not from the resolved sizeClass range', () => {
        const c = classification({ sizeClass: 'Supramax', valueMin: 55000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Supramax');
        // filled from valueMin (55000) then lenient-widened, never touches abs_min/abs_max (50000/59999)
        assert.equal(c.tonnage.valueMin, Math.round(55000 * 0.95));
        assert.equal(c.tonnage.valueMax, Math.round(55000 * 1.05));
    });

    test('numeric tonnage is preserved even when sizeClass fails to resolve at all', () => {
        const c = classification({ sizeClass: 'Imabari 61', valueMin: 25000, valueMax: 30000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Imabari 61');
        assert.equal(c.tonnage.valueMin, 25000);
        assert.equal(c.tonnage.valueMax, 30000);
    });
});

describe('correct — mutation scope', () => {
    test('mutates the passed-in object in place (does not return a new one)', () => {
        const c = classification({ sizeClass: 'Panamax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Panamax');
        assert.equal(c.tonnage.valueMin, 70000);
        assert.equal(c.tonnage.valueMax, 79999);
    });

    test('fields outside tonnage.sizeClass/valueMin/valueMax are left untouched', () => {
        const c = classification({ sizeClass: 'Panamax', unit: 'MT', raw: '70-80K' });
        c.type = 'cargo';
        c.item = 'Coal';
        c.loadPort = 'Rotterdam';
        c.dischargePort = 'Singapore';
        c.laycan = '1-10 Jul';
        c.laycanStart = '2026-07-01';
        c.laycanEnd = '2026-07-10';
        correct(c);
        assert.equal(c.tonnage.unit, 'MT');
        assert.equal(c.tonnage.raw, '70-80K');
        assert.equal(c.type, 'cargo');
        assert.equal(c.item, 'Coal');
        assert.equal(c.loadPort, 'Rotterdam');
        assert.equal(c.dischargePort, 'Singapore');
        assert.equal(c.laycan, '1-10 Jul');
        assert.equal(c.laycanStart, '2026-07-01');
        assert.equal(c.laycanEnd, '2026-07-10');
    });
});

describe('correct — K-suffix boundary conditions', () => {
    test('exactly 1000 is NOT scaled (threshold is strictly < 1000)', () => {
        const c = classification({ valueMin: 1000, valueMax: 2000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, 1000);
        assert.equal(c.tonnage.valueMax, 2000);
    });

    test('999 is scaled to 999000', () => {
        const c = classification({ valueMin: 999, valueMax: 50000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, 999000);
        assert.equal(c.tonnage.valueMax, 50000);
    });

    test('both sides under 1000 are scaled independently, then widened by the lenient-range step', () => {
        const c = classification({ valueMin: 999, valueMax: 999 });
        correct(c);
        assert.equal(c.tonnage.valueMin, Math.round(999000 * 0.95));
        assert.equal(c.tonnage.valueMax, Math.round(999000 * 1.05));
    });
});

describe('correct — additional delimiter handling', () => {
    test('en dash (–) works as a delimiter', () => {
        const c = classification({ sizeClass: 'Kamsarmax–Panamax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Kamsarmax/Panamax');
        assert.equal(c.tonnage.valueMin, 70000);
        assert.equal(c.tonnage.valueMax, 89999);
    });

    test('mixed hyphen and slash delimiters in the same combo both work', () => {
        const c = classification({ sizeClass: 'Handysize-Supramax/Ultramax' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handysize/Supramax/Ultramax');
        assert.equal(c.tonnage.valueMin, 20000);
        assert.equal(c.tonnage.valueMax, 65999);
    });

    test('whitespace padding around a slash-separated combo is trimmed before lookup', () => {
        const c = classification({ sizeClass: 'Large Handy / Supra' });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Large Handysize/Supramax');
        assert.equal(c.tonnage.valueMin, 35000);
        assert.equal(c.tonnage.valueMax, 59999);
    });
});

describe('correct — findSizeClasses reverse lookup (derives a sizeClass from a numeric range when none was given)', () => {
    test('a numeric range with no sizeClass is reverse-derived to the class that fully contains it', () => {
        const c = classification({ valueMin: 52000, valueMax: 54000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Supramax');
        assert.equal(c.tonnage.valueMin, 52000);
        assert.equal(c.tonnage.valueMax, 54000);
    });

    test('a range matching a class exactly at both boundaries resolves to that single class', () => {
        const c = classification({ valueMin: 70000, valueMax: 79999 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Panamax');
    });

    test('an already-resolved sizeClass takes priority — findSizeClasses is never consulted', () => {
        // valueMin/valueMax here numerically fall inside Supramax's bounds, but since
        // sizeClass already resolved to "Handysize" earlier, the reverse lookup must not run.
        const c = classification({ sizeClass: 'Handysize', valueMin: 52000, valueMax: 54000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handysize');
    });

    test('the wide 0-300000 fallback range matches no class, so sizeClass stays null', () => {
        const c = classification({});
        correct(c);
        assert.equal(c.tonnage.valueMin, 0);
        assert.equal(c.tonnage.valueMax, 300000);
        assert.equal(c.tonnage.sizeClass, null);
    });

    test('a range straddling two classes returns both, since matching is lenient (either endpoint falling in a class counts)', () => {
        // 46000-54000: 46000 falls inside Handymax (40000-49999), 54000 falls inside
        // Supramax (50000-59999) — findSizeClasses matches on minval OR maxval per
        // class, not full containment, so both classes come back.
        const c = classification({ valueMin: 46000, valueMax: 54000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handymax/Supramax');
    });

    test('KNOWN QUIRK: a range inside an overlapping subclass matches every superclass that contains it too', () => {
        // Handysize (20000-39999) fully contains Small Handysize (20000-29999), so a
        // range like 22000-25000 matches both and comes back as a compound label
        // instead of the single most-specific class.
        const c = classification({ valueMin: 22000, valueMax: 25000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Handysize/Small Handysize');
    });

    test('a point value near a class boundary still resolves after widening, but can pull in the neighboring class too', () => {
        // 52000 alone is squarely inside Supramax (50000-59999), but the 5% lenient
        // widening turns it into 49400-54600. findSizeClasses runs against that widened
        // range: 49400 falls inside Handymax (40000-49999) and 54600 falls inside
        // Supramax — since matching is minval-OR-maxval per class, both come back.
        const c = classification({ valueMin: 52000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, 49400);
        assert.equal(c.tonnage.valueMax, 54600);
        assert.equal(c.tonnage.sizeClass, 'Handymax/Supramax');
    });

    test('a point value closer to the middle of a bucket survives the widening and still resolves', () => {
        // 55000 widened becomes 52250-57750, which still fits entirely inside Supramax.
        const c = classification({ valueMin: 55000 });
        correct(c);
        assert.equal(c.tonnage.valueMin, 52250);
        assert.equal(c.tonnage.valueMax, 57750);
        assert.equal(c.tonnage.sizeClass, 'Supramax');
    });

    test('a direct (non-widened) range fully inside a class also resolves via the reverse lookup', () => {
        const c = classification({ valueMin: 51000, valueMax: 53000 });
        correct(c);
        assert.equal(c.tonnage.sizeClass, 'Supramax');
        assert.equal(c.tonnage.valueMin, 51000);
        assert.equal(c.tonnage.valueMax, 53000);
    });
});

describe('correct — laycan date-fill from spot/prompt/ppt patterns', () => {
    const dateSent = '2026-07-03T00:00:00.000Z';
    const expectedStart = new Date(dateSent).toISOString();
    const expectedEnd = (() => {
        const d = new Date(dateSent);
        d.setDate(d.getDate() + 3);
        return d.toISOString();
    })();

    test('lowercase "spot" fills laycanStart/laycanEnd from date_sent', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'spot';
        correct(c, dateSent);
        assert.equal(c.laycanStart, expectedStart);
        assert.equal(c.laycanEnd, expectedEnd);
    });

    test('lowercase "ppt" fills laycanStart/laycanEnd from date_sent', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'ppt';
        correct(c, dateSent);
        assert.equal(c.laycanStart, expectedStart);
        assert.equal(c.laycanEnd, expectedEnd);
    });

    test('lowercase "prompt" fills laycanStart/laycanEnd from date_sent', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'prompt';
        correct(c, dateSent);
        assert.equal(c.laycanStart, expectedStart);
        assert.equal(c.laycanEnd, expectedEnd);
    });

    test('"SPOT" (all caps) still fills dates — match is case-insensitive', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'SPOT';
        correct(c, dateSent);
        assert.equal(c.laycanStart, expectedStart);
        assert.equal(c.laycanEnd, expectedEnd);
    });

    test('"PPT" (all caps) still fills dates — match is case-insensitive', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'PPT';
        correct(c, dateSent);
        assert.equal(c.laycanStart, expectedStart);
        assert.equal(c.laycanEnd, expectedEnd);
    });

    test('"Prompt" (capitalized) still fills dates — match is case-insensitive', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'Prompt';
        correct(c, dateSent);
        assert.equal(c.laycanStart, expectedStart);
        assert.equal(c.laycanEnd, expectedEnd);
    });

    test('"Spot/Prompt" (real-world combined form) fills dates from the first matching pattern', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'Spot/Prompt';
        correct(c, dateSent);
        assert.equal(c.laycanStart, expectedStart);
        assert.equal(c.laycanEnd, expectedEnd);
    });

    test('pre-existing laycanStart/laycanEnd are preserved, not overwritten, even when a pattern matches', () => {
        const c = classification({ sizeClass: 'Panamax' });
        c.laycan = 'spot';
        c.laycanStart = '2026-01-01';
        c.laycanEnd = '2026-01-10';
        correct(c, dateSent);
        assert.equal(c.laycanStart, '2026-01-01');
        assert.equal(c.laycanEnd, '2026-01-10');
    });
});
