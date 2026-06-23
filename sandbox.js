import 'dotenv/config';
import { pollEmail } from './Email_Polling/poll_sandbox.js';
import { First_Pass_Classifier, Second_Pass_Classifier } from './External_Calls/classifier.js';
const DEBUG_PASS1 = process.env.DEBUG_PASS1 === 'true';


const email = await pollEmail("RE: A/C GNS – INT.TABONEO / S.KOR", 500, 650)
if (email == null) {
    console.log("No matching email found");
    process.exit(0)
}
const type = await First_Pass_Classifier(email.subject, email.bodyText)
console.log(type)


if (DEBUG_PASS1 === false) {
    if (type === 'MARITIME') {
        const classification = await Second_Pass_Classifier(email);
        console.log(classification[0]);
    }
}
