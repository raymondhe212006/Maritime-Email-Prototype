export const laycan_patterns = ["spot", "prompt", "ppt", "ready"];

const MONTH_INDEX = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
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

function matcherSameMonth(laycan) {
    return laycan.match(/(\d{1,2})\s*(?:-|–|to|\/)\s*(\d{1,2})\s+([A-Za-z]+)/i);
}

// Eventually add cross month matcher if needed

export function getLaycanStartEnd(laycan, date_sent) {
    const match = matcherSameMonth(laycan);
    if (!match) return undefined;
    let month = undefined;
    for (const key of Object.keys(MONTH_INDEX)) {
        if (match[3].toLowerCase().includes(key)) {
            month = MONTH_INDEX[key]
        }
    }
    if (month !== undefined) {
        const sentDate = new Date(date_sent);
        let year = sentDate.getFullYear();

        if (Number(match[1]) > 31 || Number(match[2]) > 31) {
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