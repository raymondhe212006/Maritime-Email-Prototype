import Database from 'better-sqlite3';

const db = new Database("maritime.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vessel_uid TEXT NOT NULL,
    vessel_subid TEXT NOT NULL,
    vessel_sentdate DATETIME,
    cargo_uid TEXT NOT NULL,
    cargo_subid TEXT NOT NULL,
    cargo_sentdate DATETIME
  );
`);

const insertMatch = db.prepare(`
    INSERT INTO matches (vessel_uid, vessel_subid, vessel_sentdate, cargo_uid, cargo_subid, cargo_sentdate)
    VALUES (@vessel_uid, @vessel_subid, @vessel_sentdate, @cargo_uid, @cargo_subid, @cargo_sentdate)
`);

export function addMatch(vessel, cargo) {
    const info = insertMatch.run({
        vessel_uid: vessel.uid,
        vessel_subid: vessel.sub_id,
        vessel_sentdate: vessel.sent_date,
        cargo_uid: cargo.uid,
        cargo_subid: cargo.sub_id,
        cargo_sentdate: cargo.sent_date,
    });
    return info;
}


export function getCompanyRows(company) {
    const placeholders = company.map(() => '?').join(', ');
    return db.prepare(`
      SELECT *
      FROM shipments
      WHERE company IN (${placeholders})`
    ).all(...company);
}



