import { parseEmail } from './Email_Polling/poll.js';
import fs from 'fs';
import { classify } from './External_Calls/classifier.js';
import { saveClassifications } from './Database/db.js';

// const files = [
//     "AC WOOYANG - TARAHAN  SKOR.eml",
//     "MV PAIWAN BRAVE 39K OPEN LIVERPOOL 2829TH JUNE(1).eml",
//     "HMX - SMX (7.2).eml",
//     "MVFYM EMERALD 335K06 GEARED OPEN TIANJIN 7-15 JUL(1).eml",
//     "Clipper Bulk Requirements, 23rd June 2026.eml",
// ];

const files = [
    "HMX - SMX (7.2).eml"
]

const emails = [];
for (const file of files) {
    const fullPath = `Emails/${file}`;
    const source = fs.readFileSync(fullPath);
    const email = await parseEmail({ uid: file }, source);
    emails.push(email);
}

const result = await classify(emails);

console.log(JSON.stringify(result, null, 2));

saveClassifications(result);
