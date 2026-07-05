import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
];

async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;

    if (!key) {
        throw new Error('credentials.json must contain "installed" or "web" OAuth client info');
    }

    if (!client.credentials.refresh_token) {
        throw new Error(
            'No refresh_token returned. Delete token.json if it exists, then run again and approve access.'
        );
    }

    const payload = {
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    };

    await fs.writeFile(TOKEN_PATH, JSON.stringify(payload, null, 2));
    console.log(`Saved token to: ${TOKEN_PATH}`);
}

async function main() {
    console.log('Using credentials:', CREDENTIALS_PATH);

    const client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });

    await saveCredentials(client);

    const gmail = google.gmail({ version: 'v1', auth: client });

    const profile = await gmail.users.getProfile({
        userId: 'me',
    });

    console.log('Authenticated as:', profile.data.emailAddress);
    console.log('History ID:', profile.data.historyId);
}

main().catch((err) => {
    console.error('Failed to get token:', err.message);
    process.exit(1);
});