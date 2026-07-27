import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vessel_uid TEXT NOT NULL,
    vessel_subid TEXT NOT NULL,
    vessel_date_sent DATETIME,
    cargo_uid TEXT NOT NULL,
    cargo_subid TEXT NOT NULL,
    cargo_date_sent DATETIME,
    leniency INTEGER NOT NULL,
    human_review INTEGER NOT NULL,
    whitelist_entry INTEGER NOT NULL
  );
`);

export function purgeMatches() {
    const purgeOldMatches = db.prepare(`
        DELETE FROM matches
        WHERE vessel_date_sent < datetime('now', '-7 days') OR cargo_date_sent < datetime('now', '-7 days')
    `);
    const result = purgeOldMatches.run();
    console.log(`[db] purged ${result.changes} old matches`);
    return result.changes;
}


export function addMatch(vessel, cargo, leniency, human_review, whitelist_entry) {
    const insertMatch = db.prepare(`
        INSERT INTO matches (
            vessel_uid,
            vessel_subid,
            vessel_date_sent,
            cargo_uid,
            cargo_subid,
            cargo_date_sent,
            leniency,
            human_review,
            whitelist_entry
        )
        VALUES (
            @vessel_uid,
            @vessel_subid,
            @vessel_date_sent,
            @cargo_uid,
            @cargo_subid,
            @cargo_date_sent,
            @leniency,
            @human_review,
            @whitelist_entry
        )
    `);

    return insertMatch.run({
        vessel_uid: vessel.message_id,
        vessel_subid: vessel.sub_id,
        vessel_date_sent: vessel.date_sent,
        cargo_uid: cargo.message_id,
        cargo_subid: cargo.sub_id,
        cargo_date_sent: cargo.date_sent,
        leniency: leniency,
        human_review: human_review,
        whitelist_entry: whitelist_entry
    });
}

export function getCompanyRows(company) {
    const placeholders = company.map(() => '?').join(', ');
    const statement = db.prepare(`
        SELECT *
        FROM shipments
        WHERE company IN (${placeholders})
    `);
    return statement.all(...company);
}

export function getMatches(entry, leniency = 0) {
    const tonnage_min = entry.tonnage_min;
    const tonnage_max = entry.tonnage_max;
    const laycanStart = entry.laycanStart;
    const laycanEnd = entry.laycanEnd;
    const load_country = entry.load_country;
    const type = entry.type;
    let human_review = 0

    let findType = 'cargo';
    if (type === 'cargo') {
        findType = 'vessel';
    }

    if (!laycanStart || !laycanEnd) {
        return undefined;
    }

    if (tonnage_min === 0 && tonnage_max === 300000) {
        human_review = 1;
    }

    //console.log(tonnage_min, tonnage_max, laycanStart, laycanEnd, load_country)

    if (leniency == 0) {
        if (!tonnage_min || !tonnage_max || !load_country) {
            return undefined;
        }
        const findMatches = db.prepare(`
            SELECT * FROM shipments 
            WHERE type = @findType AND tonnage_min <= @tonnage_max AND tonnage_max >= @tonnage_min 
            AND laycanStart <= @laycanEnd AND laycanEnd >= @laycanStart AND load_country = @load_country
        `)

        const rows = findMatches.all({
            findType: findType,
            tonnage_min: tonnage_min,
            tonnage_max: tonnage_max,
            laycanStart: laycanStart,
            laycanEnd: laycanEnd,
            load_country: load_country,
        });
        for (let i = 0; i < rows.length; i++) {
            rows[i].human_review = human_review;
            if (rows[i].tonnage_min === 0 && rows[i].tonnage_max === 300000) {
                rows[i].human_review = 1;
            }
        }
        return rows;
    }
    else if (leniency == 1) {
        if (!tonnage_min || !tonnage_max) {
            return undefined;
        }
        const findMatches = db.prepare(`
            SELECT * FROM shipments 
            WHERE type = @findType AND tonnage_min <= @tonnage_max AND tonnage_max >= @tonnage_min 
            AND laycanStart <= @laycanEnd AND laycanEnd >= @laycanStart
        `)

        const rows = findMatches.all({
            findType: findType,
            tonnage_min: tonnage_min,
            tonnage_max: tonnage_max,
            laycanStart: laycanStart,
            laycanEnd: laycanEnd,
        });
        for (let i = 0; i < rows.length; i++) {
            rows[i].human_review = human_review;
            if (rows[i].tonnage_min === 0 && rows[i].tonnage_max === 300000) {
                rows[i].human_review = 1;
            }
        }
        return rows;
    }
    return undefined;
}

export function checkDuplicate(vessel, cargo) {
    const statement = db.prepare(`
        SELECT id FROM matches 
        WHERE vessel_uid = @vessel_uid AND vessel_subid = @vessel_subid AND cargo_uid = @cargo_uid AND cargo_subid = @cargo_subid
    `);
    const row = statement.get({
        vessel_uid: vessel.message_id,
        vessel_subid: vessel.sub_id,
        cargo_uid: cargo.message_id,
        cargo_subid: cargo.sub_id,
    });

    return row === undefined;
}
