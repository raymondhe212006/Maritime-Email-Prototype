import Database from 'better-sqlite3';

const db = new Database('./Information/maritime_legacy.db');

// Find unique values in one column
const uniqueTypes = db.prepare(`
    SELECT DISTINCT size_class
    FROM shipments
    WHERE size_class IS NOT NULL
      AND size_class != ''
    ORDER BY size_class
`).all();

console.log(uniqueTypes.map(row => row.size_class));