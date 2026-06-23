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
        laycanStart TEXT,
        laycanEnd   TEXT
    )
`);

const insertShipment = db.prepare(`
    INSERT INTO shipments
        (subject, body_preview, type, company, date_sent, tonnage_min, tonnage_max, load_port, discharge_port, cargo, laycan, laycanStart, laycanEnd)
    VALUES
        (@subject, @body_preview, @type, @company, @date_sent, @tonnage_min, @tonnage_max, @load_port, @discharge_port, @cargo, @laycan, @laycanStart, @laycanEnd)
`);


export function saveClassifications(queue) {
    for (let i = 0; i < queue.length; i++) {
        const subject = queue[i].subject;
        const company = queue[i].company;
        const time_sent = queue[i].time_sent;
        const classifications = queue[i].classifications;
        const dateSent = time_sent ? new Date(time_sent).toISOString() : null;
        const bodyPreview = queue[i].body_preview

        insertShipment.run({
            subject: subject ?? null,
            body_preview: bodyPreview,
            type: classifications.type,
            company: company,
            date_sent: dateSent,
            tonnage_min: classifications.tonnage?.valueMin ?? null,
            tonnage_max: classifications.tonnage?.valueMax ?? null,
            load_port: classifications.loadPort,
            discharge_port: classifications.dischargePort,
            cargo: classifications.cargo,
            laycan: classifications.laycan,
            laycanStart: classifications.laycanStart,
            laycanEnd: classifications.laycanEnd,
        });
    }
}
const selectBySubject = db.prepare('SELECT * FROM shipments WHERE subject = ?');
const deleteBySubject = db.prepare('DELETE FROM shipments WHERE subject = ?');

export function getShipmentsBySubject(subject) {
    return selectBySubject.all(subject);
}

export function deleteShipmentsBySubject(subject) {
    deleteBySubject.run(subject);
}

const purgeOldShipments = db.prepare(`
    DELETE FROM shipments
    WHERE date_sent < datetime('now', '-14 days')
`);

export function purgeShipmentsOlderThanTwoWeeks() {
    const result = purgeOldShipments.run();
    console.log(`[db] purged ${result.changes} old shipments`);
    return result.changes;
}