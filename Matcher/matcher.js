import { getCompanyRows, addMatch } from "../Database/db_matches.js";
import fs from "fs";

const text = fs.readFileSync("Email_Whitelist.txt", "utf8");

console.log(text.split('\n'));

