import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(__dirname, 'maritime.db'));

db.exec(`
    CREATE TABLE IF NOT EXISTS shipments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id  TEXT,
        sub_id      TEXT,
        subject     TEXT,
        body        TEXT,
        type        TEXT,
        company     TEXT,
        date_sent   TEXT,
        tonnage_min INTEGER,
        tonnage_max INTEGER,
        size_class  TEXT,
        load_port   TEXT,
        load_country TEXT,
        discharge_port TEXT,
        discharge_country TEXT,
        item       TEXT,
        laycan      TEXT,
        laycanStart TEXT,
        laycanEnd   TEXT
    )
`);

const insertShipment = db.prepare(`
    INSERT INTO shipments
        (message_id, sub_id, subject, body, type, company, date_sent, tonnage_min, tonnage_max, size_class, load_port, load_country, discharge_port, discharge_country, item, laycan, laycanStart, laycanEnd)
    VALUES
        (@message_id, @sub_id, @subject, @body, @type, @company, @date_sent, @tonnage_min, @tonnage_max, @size_class, @load_port, @load_country, @discharge_port, @discharge_country, @item, @laycan, @laycanStart, @laycanEnd)
`);
export function saveClassifications(queue) {
    for (let i = 0; i < queue.length; i++) {
        const subject = queue[i].subject;
        const company = queue[i].company;
        const time_sent = queue[i].time_sent;
        const classifications = queue[i].classifications;
        const dateSent = time_sent ? new Date(time_sent).toISOString() : null;
        const body = queue[i].body

        insertShipment.run({
            message_id: queue[i].message_id,
            sub_id: queue[i].sub_id,
            subject: subject ?? null,
            body: body,
            type: classifications.type,
            company: company,
            date_sent: dateSent,
            tonnage_min: classifications.tonnage?.valueMin ?? null,
            tonnage_max: classifications.tonnage?.valueMax ?? null,
            size_class: classifications.tonnage?.sizeClass ?? null,
            load_port: classifications.loadPort,
            load_country: classifications.loadCountry,
            discharge_port: classifications.dischargePort,
            discharge_country: classifications.dischargeCountry,
            item: classifications.item,
            laycan: classifications.laycan,
            laycanStart: classifications.laycanStart,
            laycanEnd: classifications.laycanEnd,
        });
    }
}


const purgeOldShipments = db.prepare(`
    DELETE FROM shipments
    WHERE date_sent < datetime('now', '-14 days')
`);
export function purgeEmails() {
    const result = purgeOldShipments.run();
    console.log(`[db] purged ${result.changes} old shipments`);
    return result.changes;
}

const check_duplicate_sql = db.prepare(`
    SELECT * FROM shipments
    WHERE message_id = ?
`);
export function check_duplicate(message_id) {
    const result = check_duplicate_sql.get(message_id);
    return result;
}