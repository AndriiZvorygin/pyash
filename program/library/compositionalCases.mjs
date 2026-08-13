// library/compositionalCases.mjs
// Compositional case grid for Pyash.
// Contexts + (source, way, destination) axes → canonical *_case_ hex
// plus single-token keyword glosses for each (axis, context).

export const COMPOSITIONAL_CONTEXT_ORDER = Object.freeze([
  "space",
  "interior",
  "surface",
  "under",
  "time",
  "state",
  "person",
  "social",
  "discourse",
  "quantity",
  "limit",
  "sequence"
]);

export const COMPOSITIONAL_AXIS_ORDER = Object.freeze([
  "source",
  "way",
  "destination"
]);

// Short aliases keep consumers readable while the longer names document scope.
export const CONTEXT_ORDER = COMPOSITIONAL_CONTEXT_ORDER;
export const AXIS_ORDER = COMPOSITIONAL_AXIS_ORDER;

const unassigned = (keyword, axis) => ({
  axis,
  keyword,
  status: "unassigned",
  case: null,
  hnuc: null,
  pya: null
});

const unassignedContext = name => ({
  name,
  status: "unassigned",
  hnuc: null,
  pya: null
});

export const compositionalGrid = {
  // Default context: if nothing is marked, assume "space".
  space: {
    context: { name: "space_context_", hnuc: "0x315E", pya: "to" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      keyword: "from", // SOURCE + space
    },

    way: {
      axis: "way",
      case: "way_case_",
      hnuc: "0x265E",
      pya: "ga",
      keyword: "at",   // WAY + space
    },

    destination: {
      axis: "destination",
      case: "destination_case_",
      hnuc: "0x243E",
      pya: "ma",
      keyword: "to",   // DEST + space
    },
  },

  interior: {
    context: { name: "interior_context_", hnuc: "0x28DE", pya: "nu" },

    source: {
      axis: "source",
      case: "elative_case_",
      hnuc: "0x4957",
      pya: "twah",
      keyword: "outof", // SOURCE + interior
    },

    way: {
      axis: "way",
      case: "perlative_case_",
      hnuc: "0x495F",
      pya: "lwah",
      keyword: "in", // WAY + interior
    },

    destination: {
      axis: "destination",
      case: "illative_case_",
      hnuc: "0x4157",
      pya: "twih",
      keyword: "into",   // DEST + interior
    },
  },

  surface: {
    context: { name: "surface_context_", hnuc: "0x209E", pya: "pi" },

    source: {
      axis: "source",
      case: "delative_case_",
      hnuc: "0x415F",
      pya: "lwih",
      keyword: "offof", // SOURCE + surface
    },

    way: {
      axis: "way",
      case: "perlative_case_",
      hnuc: "0x495F",
      pya: "lwah",
      keyword: "on", // WAY + surface
    },

    destination: {
      axis: "destination",
      case: "sublative_case_",
      hnuc: "0x594F",
      pya: "sweh",
      keyword: "onto",  // DEST + surface
    },
  },

  under: {
    context: { name: "under_context_", hnuc: "0x2DBE", pya: "ce" },

    source: {
      axis: "source",
      case: "ablative_case_",
      hnuc: "0x4127",
      pya: "pwih",
      keyword: "fromunder", // SOURCE + under
    },

    way: {
      axis: "way",
      case: "perlative_case_",
      hnuc: "0x495F",
      pya: "lwah",
      keyword: "under",     // WAY + under
    },

    destination: {
      axis: "destination",
      case: "subessive_case_",
      hnuc: "0x5C8F",
      pya: "bveh",
      keyword: "beneath",   // DEST + under
    },
  },

  time: {
    context: { name: "time_context_", hnuc: "0x2D3E", pya: "se" },

    source: {
      axis: "source",
      case: "antessive_case_",
      hnuc: "0x8257",
      pya: "tsi7h",
      keyword: "since", // SOURCE + time (before/since)
    },

    way: {
      axis: "way",
      case: "temporal_case_",
      hnuc: "0x480F",
      pya: "myah",
      keyword: "during", // WAY + time
    },

    destination: {
      axis: "destination",
      case: "terminative_case_",
      hnuc: "0x5957",
      pya: "tweh",
      keyword: "until", // DEST + time
    },
  },

  state: {
    context: { name: "state_context_", hnuc: "0x31DE", pya: "ro" },

    source: {
      axis: "source",
      case: "exessive_case_",
      hnuc: "0x4757",
      pya: "txih",
      keyword: "fromstate", // SOURCE + state
    },

    way: {
      axis: "way",
      case: "essive_case_",
      hnuc: "0x414F",
      pya: "swih",
      keyword: "as",       // WAY + state (semantically “as”)
    },

    destination: {
      axis: "destination",
      case: "to_case_",
      hnuc: "0x5F17",
      pya: "kxeh",
      keyword: "become",    // DEST + state (into being)
    },
  },

  person: {
    context: { name: "person_context_", hnuc: "0x249E", pya: "pa" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      keyword: "fromperson", // SOURCE + person
    },

    way: {
      axis: "way",
      case: "comitative_case_",
      hnuc: "0x490F",
      pya: "mwah",
      keyword: "with",       // WAY + person
    },

    destination: {
      axis: "destination",
      case: "dative_case_",
      hnuc: "0x207E",
      pya: "yi",
      keyword: "for",        // DEST + person
    },
  },

  social: {
    context: { name: "social_context_", hnuc: "0x31BE", pya: "co" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      keyword: "fromgroup", // SOURCE + social
    },

    way: {
      axis: "way",
      case: "associative_case_",
      hnuc: "0x453E",
      pya: "sa7",
      keyword: "among",     // WAY + social
    },

    destination: {
      axis: "destination",
      case: "benefactive_case_",
      hnuc: "0x4927",
      pya: "pwah",
      keyword: "intogroup", // DEST + social (for/as part of group)
    },
  },

  discourse: {
    context: { name: "discourse_context_", hnuc: "0x275E", pya: "xa" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      keyword: "fromtext",   // SOURCE + discourse (from this text/source)
    },

    way: {
      axis: "way",
      case: "evidential_case_",
      hnuc: "0x4937",
      pya: "nwah",
      keyword: "accordingto", // WAY + discourse
    },

    destination: {
      axis: "destination",
      case: "quotative_case_",
      hnuc: "0x6157",
      pya: "twoh",
      keyword: "totext",      // DEST + discourse (as text/quote)
    },
  },

  quantity: {
    context: unassignedContext("quantity_context_"),

    source: {
      axis: "source",
      case: "multiplicative_case_",
      hnuc: "0x6357",
      pya: "fromindex",
      keyword: "times",       // SOURCE + quantity (loop/multiplicative register)
    },

    way: {
      axis: "way",
      case: "quantity_way_case_",
      ...unassigned("by", "way"),
      // WAY + quantity (step/stride)
    },

    destination: {
      axis: "destination",
      case: "quantity_destination_case_",
      ...unassigned("per", "destination"),
      // DEST + quantity (per-unit target)
    },
  },

  limit: {
    context: unassignedContext("limit_context_"),

    source: {
      axis: "source",
      case: "limit_source_case_",
      ...unassigned("atleast", "source"),
      // SOURCE + limit (lower bound)
    },

    way: {
      axis: "way",
      case: "limit_way_case_",
      ...unassigned("exactly", "way"),
      // WAY + limit (exact match)
    },

    destination: {
      axis: "destination",
      case: "limit_destination_case_",
      ...unassigned("atmost", "destination"),
      // DEST + limit (upper bound)
    },
  },

  sequence: {
    context: unassignedContext("sequence_context_"),

    source: unassigned("fromindex", "source"),
    way: unassigned("atindex", "way"),
    destination: unassigned("toindex", "destination"),
  },
};

// Context hints are derived against the canonical context rows below.

const CONTEXT_HINTS = {
  space: ["space", "spatial", "path", "location", "place", "motion"],
  interior: ["inside", "interior", "in", "inward", "room", "container"],
  surface: ["surface", "on", "top", "table", "floor", "wall"],
  under: ["under", "below", "beneath", "subsurface"],
  time: ["time", "before", "during", "after", "until", "when"],
  state: ["state", "condition", "mode", "type", "representation"],
  person: ["person", "agent", "speaker", "listener", "user"],
  social: ["group", "community", "social", "organisation", "team"],
  discourse: ["text", "discourse", "quote", "source", "document", "corpus"],
  quantity: ["quantity", "count", "per", "by", "rate", "times"],
  limit: ["limit", "bound", "range", "atleast", "exactly", "atmost"],
  sequence: ["sequence", "index", "ordered", "position", "fromindex", "toindex"]
};

export const contextKeywords = Object.fromEntries(
  COMPOSITIONAL_CONTEXT_ORDER.map(context => {
    const entry = {
      key: context,
      contextWord: compositionalGrid[context].context.name,
      hints: CONTEXT_HINTS[context]
    };
    if (context === "space") entry.default = true;
    return [context, entry];
  })
);

// Reverse lookup is one-to-many: a reused morpheme identifies the grammatical
// morpheme, but not the context in which the grid used it.
export const compositionalByHnuc = Object.fromEntries(
  COMPOSITIONAL_CONTEXT_ORDER.reduce((entries, context) => {
    for (const axis of COMPOSITIONAL_AXIS_ORDER) {
      const info = compositionalGrid[context][axis];
      if (!info?.hnuc || info.status === "unassigned") continue;
      const key = info.hnuc.toLowerCase();
      const mapping = {
        context,
        axis: info.axis,
        case: info.case,
        pya: info.pya,
        keyword: info.keyword,
        prep: info.keyword
      };
      const current = entries.get(key) ?? [];
      current.push(mapping);
      entries.set(key, current);
    }
    return entries;
  }, new Map())
);

export const axisContextToKeyword = Object.fromEntries(
  COMPOSITIONAL_CONTEXT_ORDER.map(context => [
    context,
    Object.fromEntries(COMPOSITIONAL_AXIS_ORDER.map(axis => [
      axis,
      compositionalGrid[context][axis].keyword
    ]))
  ])
);

export const keywordToAxisContext = Object.fromEntries(
  COMPOSITIONAL_CONTEXT_ORDER.flatMap(context => (
    COMPOSITIONAL_AXIS_ORDER.map(axis => [
      compositionalGrid[context][axis].keyword,
      { axis, context }
    ])
  ))
);
