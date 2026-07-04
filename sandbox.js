import { parseEmail } from './Email_Polling/poll.js';
import fs from 'fs';
import { classify } from './External_Calls/classifier.js';
import { saveClassifications } from './Database/db.js';

const file = "63.4 K LIANYUNGANG 13_JUL, 63.4 K DALIAN OR YEOSU 11_JUL, 2X25T_DECK_GOA OK, 55.6 K HAIKOU 8_JUL, 63.6 K MARIVELES 11_JUL, 63.2 K FUJAIRAH 12_JUL.eml";
const fullPath = `Emails/${file}`;
const source = fs.readFileSync(fullPath);

const email = await parseEmail({ uid: file }, source);

//console.log(email.bodyText);

const result = await classify([email]);

//console.log(result);

saveClassifications(result);