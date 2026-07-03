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
