export const laycan_patterns = ["spot", "prompt", "ppt", "ready"];

const MONTHS = {
    jan: { index: 0, days: 31 },
    january: { index: 0, days: 31 },

    feb: { index: 1, days: 28 },
    february: { index: 1, days: 28 },

    mar: { index: 2, days: 31 },
    march: { index: 2, days: 31 },

    apr: { index: 3, days: 30 },
    april: { index: 3, days: 30 },

    may: { index: 4, days: 31 },

    jun: { index: 5, days: 30 },
    june: { index: 5, days: 30 },

    jul: { index: 6, days: 31 },
    july: { index: 6, days: 31 },

    aug: { index: 7, days: 31 },
    august: { index: 7, days: 31 },

    sep: { index: 8, days: 30 },
    sept: { index: 8, days: 30 },
    september: { index: 8, days: 30 },

    oct: { index: 9, days: 31 },
    october: { index: 9, days: 31 },

    nov: { index: 10, days: 30 },
    november: { index: 10, days: 30 },

    dec: { index: 11, days: 31 },
    december: { index: 11, days: 31 },
};

export const VESSEL_CLASS_ALIASES = {
    handysize: {
        name: "Handysize",
        min_dwt: 20000,
        max_dwt: 39999,
        aliases: [
            "Handy",
            "Handysize"
        ]
    },
    small_handysize: {
        name: "Small Handysize",
        min_dwt: 20000,
        max_dwt: 29999,
        aliases: [
            "Small Handy",
            "Small Handysize",
            "Small-Handy",
            "Small-Handysize",
            "S.Handy"
        ]
    },

    light_handysize: {
        name: "Light Handysize",
        min_dwt: 30000,
        max_dwt: 34999,
        aliases: [
            "Light Handy",
            "Light Handysize",
            "Light-Handy",
            "Light-Handysize",
            "L.Handy"
        ]
    },

    large_handysize: {
        name: "Large Handysize",
        min_dwt: 35000,
        max_dwt: 39999,
        aliases: [
            "Large Handy",
            "Large Handysize",
            "Large-Handy",
            "Large-Handysize"
        ]
    },

    handymax: {
        name: "Handymax",
        min_dwt: 40000,
        max_dwt: 49999,
        aliases: [
            "Handymax"
        ]
    },

    supramax: {
        name: "Supramax",
        min_dwt: 50000,
        max_dwt: 59999,
        aliases: [
            "Supramax",
            "SMX",
            "Supra"
        ]
    },

    ultramax: {
        name: "Ultramax",
        min_dwt: 60000,
        max_dwt: 65999,
        aliases: [
            "Ultramax",
            "UMX",
            "UMAX",
        ]
    },

    panamax: {
        name: "Panamax",
        min_dwt: 70000,
        max_dwt: 79999,
        aliases: [
            "Panamax",
            "LME"
        ]
    },

    kamsarmax: {
        name: "Kamsarmax",
        min_dwt: 80000,
        max_dwt: 89999,
        aliases: [
            "Kamsarmax",
            "KMX",
            "KMAX"
        ]
    },

    post_panamax: {
        name: "Post Panamax",
        min_dwt: 90000,
        max_dwt: 129999,
        aliases: [
            "Post Panamax",
            "Post-Panamax"
        ]
    },

    capesize: {
        name: "Capesize",
        min_dwt: 130000,
        max_dwt: 189999,
        aliases: [
            "Capesize"
        ]
    },
    nuke: {
        name: "Nuke",
        sub_class: "Nuke",
        min_dwt: 200000,
        max_dwt: 220000,
        aliases: [
            "Nuke",
            "Newcastlemax",
            "Newcastle Max",
            "NMKC",
            "Newcastle-Max",
        ]
    }
};

function normalize(s) {
    return s.trim().toLowerCase();
}

const ALIAS_LOOKUP = new Map();
for (const cls of Object.values(VESSEL_CLASS_ALIASES)) {
    for (const alias of cls.aliases) {
        ALIAS_LOOKUP.set(normalize(alias), cls);
    }
}

export function resolveVesselClass(raw) {
    if (!raw) return null;
    return ALIAS_LOOKUP.get(normalize(raw)) ?? null;
}

export function findSizeClasses(minval, maxval) {
    let classes = ""
    for (const cls of Object.values(VESSEL_CLASS_ALIASES)) {
        if (minval >= cls.min_dwt && minval <= cls.max_dwt || maxval >= cls.min_dwt && maxval <= cls.max_dwt) {
            classes += cls.name + "/"
        }
    }

    return classes.length > 0 ? classes.slice(0, -1) : null;
}

function matcherSameMonthNumbers(laycan) {
    return laycan.match(/(\d{1,2})\s*(?:-|–|to|\/)\s*(\d{1,2})\s+([A-Za-z]+)/i);
}

function matcherSameMonthText(laycan) {
    return laycan.match(/\b(Early|Mid|End)\b(.*)/i);
}

// Eventually add cross month matcher if needed

export function getLaycanStartEnd(laycan, date_sent) {
    let match = matcherSameMonthNumbers(laycan);
    if (match) {
        let month = undefined;
        let month_end = 31;
        for (const key of Object.keys(MONTHS)) {
            if (match[3].toLowerCase().includes(key)) {
                month = MONTHS[key].index;
                month_end = MONTHS[key].days;
            }
        }
        if (month !== undefined) {
            const sentDate = new Date(date_sent);
            let year = sentDate.getFullYear();

            if (Number(match[1]) > month_end || Number(match[2]) > month_end || Number(match[1]) < 1 || Number(match[2]) < 1) {
                return undefined;
            }

            let start = new Date(Date.UTC(year, month, Number(match[1])));
            // If the resolved date falls more than a month before the email was sent, assume next year
            if (start.getTime() < sentDate.getTime() - 30 * 24 * 60 * 60 * 1000) {
                year += 1;
                start = new Date(Date.UTC(year, month, Number(match[1])));
            }
            let end = new Date(Date.UTC(year, month, Number(match[2])));
            return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
        }
    }
    match = matcherSameMonthText(laycan);
    if (match) {
        let month = undefined;
        let month_end = 31;
        for (const key of Object.keys(MONTHS)) {
            if (match[2].toLowerCase().includes(key)) {
                month = MONTHS[key].index;
                month_end = MONTHS[key].days;
            }
        }
        if (month !== undefined) {
            const sentDate = new Date(date_sent);
            let year = sentDate.getFullYear();
            let start_day = 1;
            let end_day = month_end;
            if (match[1].toLowerCase() === "early") {
                start_day = 1;
                end_day = 10;
            } else if (match[1].toLowerCase() === "mid") {
                start_day = 11;
                end_day = 20;
            } else if (match[1].toLowerCase() === "end") {
                start_day = 21;
                end_day = month_end;
            }

            let start = new Date(Date.UTC(year, month, start_day));
            // If the resolved date falls more than a month before the email was sent, assume next year
            if (start.getTime() < sentDate.getTime() - 30 * 24 * 60 * 60 * 1000) {
                year += 1;
                start = new Date(Date.UTC(year, month, start_day));
            }
            let end = new Date(Date.UTC(year, month, end_day));
            return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
        }
    }

    return undefined;
}