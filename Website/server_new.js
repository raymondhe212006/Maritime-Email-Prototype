import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'Database', 'maritime.db'));
const app = express();
const PORT = process.env.PORT || 3000;
const PURGE_SECRET = process.env.PURGE_SECRET || '';
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';

if (SITE_PASSWORD) {
    app.use((req, res, next) => {
        const auth = req.headers['authorization'];
        if (auth) {
            const b64 = auth.split(' ')[1] || '';
            const [, pass] = Buffer.from(b64, 'base64').toString().split(':');
            if (pass === SITE_PASSWORD) return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="Maritime"');
        res.status(401).send('Unauthorized');
    });
}

app.get('/', (req, res) => res.send(HTML));

app.listen(PORT, () => console.log(`[website] http://localhost:${PORT}`));

const HTML = ``;
