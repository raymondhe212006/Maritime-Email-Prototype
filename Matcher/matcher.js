import { getCompanyRows, addMatch, getMatches, checkDuplicate } from "../Database/db_matches.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function match() {
    const text = fs.readFileSync(path.join(__dirname, "Email_Whitelist.txt"), "utf8");
    const companies = text.split('\n').filter(company => company.trim() !== '');
    const res = getCompanyRows(companies);

    for (let entry of res) {
        const matches_hard = getMatches(entry, 0);
        if (matches_hard) {
            for (let match of matches_hard) {
                if (entry.type === 'vessel' && checkDuplicate(entry, match)) {
                    addMatch(entry, match, 0, match.human_review, 0);
                }
                if (entry.type === 'cargo' && checkDuplicate(match, entry)) {
                    addMatch(match, entry, 0, match.human_review, 1);
                }
            }
        }

        const matches_lenient = getMatches(entry, 1);
        if (matches_lenient) {
            for (let match of matches_lenient) {
                if (entry.type === 'vessel' && checkDuplicate(entry, match)) {
                    addMatch(entry, match, 1, match.human_review, 0);
                }
                if (entry.type === 'cargo' && checkDuplicate(match, entry)) {
                    addMatch(match, entry, 1, match.human_review, 1);
                }
            }
        }
    }
}



