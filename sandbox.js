import { parseEmail } from './Email_Polling/poll.js';
import fs from 'fs';
import { classify } from './External_Calls/classifier_gemini.js';
import { saveClassifications } from './Database/db.js';

const files = fs.readdirSync('Emails');
const file = files[0];
const fullPath = `Emails/${file}`;
const source = fs.readFileSync(fullPath);
const email = await parseEmail({ uid: file }, source);

console.log(email);

const result = await classify([email]);

console.log(result);

saveClassifications(result);