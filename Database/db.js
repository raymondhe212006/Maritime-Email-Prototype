import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'maritime.db'));

db.exec(`
    CREATE TABLE IF NOT EXISTS shipments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        subject     TEXT,
        body_preview TEXT,
        type        TEXT,
        company     TEXT,
        date_sent   TEXT,
        tonnage_min INTEGER,
        tonnage_max INTEGER,
        load_port   TEXT,
        discharge_port TEXT,
        cargo       TEXT,
        laycan      TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
    )
`);

const insertShipment = db.prepare(`
    INSERT INTO shipments
        (subject, body_preview, type, company, date_sent, tonnage_min, tonnage_max, load_port, discharge_port, cargo, laycan)
    VALUES
        (@subject, @body_preview, @type, @company, @date_sent, @tonnage_min, @tonnage_max, @load_port, @discharge_port, @cargo, @laycan)
`);

export function saveClassifications(email, classifications) {
    const company = email.from?.match(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0]?.toLowerCase() ?? null;
    const dateSent = email.date ? new Date(email.date).toISOString() : null;
    const bodyPreview = (email.bodyText || '').slice(0, 300);

    for (const c of classifications) {
        insertShipment.run({
            subject: email.subject ?? null,
            body_preview: bodyPreview,
            type: c.type,
            company,
            date_sent: dateSent,
            tonnage_min: c.tonnage?.valueMin ?? null,
            tonnage_max: c.tonnage?.valueMax ?? null,
            load_port: c.loadPort,
            discharge_port: c.dischargePort,
            cargo: c.cargo,
            laycan: c.laycan,
        });
    }
}
