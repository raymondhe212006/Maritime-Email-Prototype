import { db } from './db.js';

const EDITABLE_COLUMNS = new Set([
    'message_id', 'sub_id', 'subject', 'body', 'type', 'company', 'date_sent',
    'tonnage_min', 'tonnage_max', 'size_class', 'load_port', 'load_country',
    'discharge_port', 'discharge_country', 'item', 'laycan', 'laycanStart', 'laycanEnd',
]);

const [, , idArg, ...pairs] = process.argv;

if (!idArg || pairs.length === 0) {
    console.log('Usage: node Database/edit.js <id> field=value [field2=value2 ...]');
    console.log(`Editable fields: ${[...EDITABLE_COLUMNS].join(', ')}`);
    process.exit(1);
}

const id = Number(idArg);
const existing = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
if (!existing) {
    console.error(`No shipment found with id ${id}`);
    process.exit(1);
}

const updates = {};
for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
        console.error(`Skipping invalid argument (expected field=value): ${pair}`);
        continue;
    }
    const key = pair.slice(0, eqIdx);
    let value = pair.slice(eqIdx + 1);
    if (!EDITABLE_COLUMNS.has(key)) {
        console.error(`Skipping unknown/non-editable column: ${key}`);
        continue;
    }
    if (value === 'null') {
        value = null;
    } else if (key === 'tonnage_min' || key === 'tonnage_max') {
        value = Number(value);
    }
    updates[key] = value;
}

const keys = Object.keys(updates);
if (keys.length === 0) {
    console.error('No valid fields to update.');
    process.exit(1);
}

const setClause = keys.map(k => `${k} = @${k}`).join(', ');
db.prepare(`UPDATE shipments SET ${setClause} WHERE id = @id`).run({ ...updates, id });

console.log('Before:', existing);
console.log('After: ', db.prepare('SELECT * FROM shipments WHERE id = ?').get(id));
