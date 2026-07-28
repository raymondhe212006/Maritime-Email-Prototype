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

const check_time = db.prepare(`
    SELECT * FROM shipments
    WHERE sub_id IS @sub_id AND company IS @company 
    AND tonnage_min IS @tonnage_min AND tonnage_max IS @tonnage_max AND size_class IS @size_class 
    AND load_port IS @load_port AND load_country IS @load_country AND discharge_port IS @discharge_port 
    AND discharge_country IS @discharge_country AND item IS @item AND laycan IS @laycan 
    AND laycanStart IS @laycanStart AND laycanEnd IS @laycanEnd
`);

function time_check(sub_id, company, tonnage_min, tonnage_max, size_class, load_port, load_country, discharge_port, discharge_country, item, laycan, laycanStart, laycanEnd) {
    const result = check_time.get({
        sub_id: sub_id,
        company: company,
        tonnage_min: tonnage_min,
        tonnage_max: tonnage_max,
        size_class: size_class,
        load_port: load_port,
        load_country: load_country,
        discharge_port: discharge_port,
        discharge_country: discharge_country,
        item: item,
        laycan: laycan,
        laycanStart: laycanStart,
        laycanEnd: laycanEnd
    });
    return result
}

const update_time_sql = db.prepare(`
    UPDATE shipments
    SET date_sent = @date_sent
    WHERE message_id = @message_id AND sub_id = @sub_id
`);

function update_time(message_id, sub_id, date_sent) {
    const result = update_time_sql.run({
        message_id: message_id,
        sub_id: sub_id,
        date_sent: date_sent
    });
    return result
}

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

        const check = time_check(queue[i].sub_id, company, classifications.tonnage?.valueMin ?? null, classifications.tonnage?.valueMax ?? null, classifications.tonnage?.sizeClass ?? null, classifications.loadPort, classifications.loadCountry, classifications.dischargePort, classifications.dischargeCountry, classifications.item, classifications.laycan, classifications.laycanStart, classifications.laycanEnd)
        if (check) {
            update_time(check.message_id, check.sub_id, dateSent);
            continue;
        }

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
    WHERE date_sent < datetime('now', '-7 days')
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