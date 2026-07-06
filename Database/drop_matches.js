import { db } from './db.js';

db.exec('DROP TABLE IF EXISTS matches');
console.log('[db] dropped matches table');
