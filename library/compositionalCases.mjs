// library/compositionalCases.mjs
// Compositional case grid for Pyash.
// Contexts + (source, way, destination) axes → canonical *_case_ hex.

export const compositionalGrid = {
  // Default context: if nothing is marked, assume "space".
  space: {
    context: { name: "space_context_", hnuc: "0x315E", pya: "to" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      prep: "from",
    },

    way: {
      axis: "way",
      case: "way_case_",
      hnuc: "0x265E",
      pya: "ga",
      prep: "via", // or "along"
    },

    destination: {
      axis: "destination",
      case: "destination_case_",
      hnuc: "0x243E",
      pya: "ma",
      prep: "to", // or "toward"
    },
  },

  interior: {
    context: { name: "interior_context_", hnuc: "0x28DE", pya: "nu" },

    source: {
      axis: "source",
      case: "elative_case_",
      hnuc: "0x4957",
      pya: "twah",
      prep: "out of", // "from inside"
    },

    way: {
      axis: "way",
      case: "perlative_case_",
      hnuc: "0x495F",
      pya: "lwah",
      prep: "through",
    },

    destination: {
      axis: "destination",
      case: "illative_case_",
      hnuc: "0x4157",
      pya: "twih",
      prep: "into",
    },
  },

  surface: {
    context: { name: "surface_context_", hnuc: "0x209E", pya: "pi" },

    source: {
      axis: "source",
      case: "delative_case_",
      hnuc: "0x415F",
      pya: "lwih",
      prep: "off",
    },

    way: {
      axis: "way",
      case: "perlative_case_",
      hnuc: "0x495F",
      pya: "lwah",
      prep: "along", // or "across"
    },

    destination: {
      axis: "destination",
      case: "sublative_case_",
      hnuc: "0x594F",
      pya: "sweh",
      prep: "onto",
    },
  },

  under: {
    context: { name: "under_context_", hnuc: "0x2DBE", pya: "ce" },

    source: {
      axis: "source",
      case: "ablative_case_",
      hnuc: "0x4127",
      pya: "pwih",
      prep: "from under",
    },

    way: {
      axis: "way",
      case: "perlative_case_",
      hnuc: "0x495F",
      pya: "lwah",
      prep: "under", // or "along under"
    },

    destination: {
      axis: "destination",
      case: "subessive_case_",
      hnuc: "0x5C8F",
      pya: "bveh",
      prep: "to under", // or "underneath"
    },
  },

  time: {
    context: { name: "time_context_", hnuc: "0x2D3E", pya: "se" },

    source: {
      axis: "source",
      case: "antessive_case_",
      hnuc: "0x8257",
      pya: "tsi7h",
      prep: "before",
    },

    way: {
      axis: "way",
      case: "temporal_case_",
      hnuc: "0x480F",
      pya: "myah",
      prep: "during",
    },

    destination: {
      axis: "destination",
      case: "terminative_case_",
      hnuc: "0x5957",
      pya: "tweh",
      prep: "until", // or "up to"
    },
  },

  state: {
    context: { name: "state_context_", hnuc: "0x31DE", pya: "ro" },

    source: {
      axis: "source",
      case: "exessive_case_",
      hnuc: "0x4757",
      pya: "txih",
      prep: "out of (being)",
    },

    way: {
      axis: "way",
      case: "essive_case_",
      hnuc: "0x414F",
      pya: "swih",
      prep: "as", // "in the state of"
    },

    destination: {
      axis: "destination",
      case: "to_case_",
      hnuc: "0x5F17",
      pya: "kxeh",
      prep: "into (being)", // "to (being)"
    },
  },

  person: {
    context: { name: "person_context_", hnuc: "0x249E", pya: "pa" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      prep: "from", // or "by"
    },

    way: {
      axis: "way",
      case: "comitative_case_",
      hnuc: "0x490F",
      pya: "mwah",
      prep: "with",
    },

    destination: {
      axis: "destination",
      case: "dative_case_",
      hnuc: "0x207E",
      pya: "yi",
      prep: "to", // or "for"
    },
  },

  social: {
    context: { name: "social_context_", hnuc: "0x31BE", pya: "co" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      prep: "from",
    },

    way: {
      axis: "way",
      case: "associative_case_",
      hnuc: "0x453E",
      pya: "sa7",
      prep: "with", // "as part of"
    },

    destination: {
      axis: "destination",
      case: "benefactive_case_",
      hnuc: "0x4927",
      pya: "pwah",
      prep: "for",
    },
  },

  discourse: {
    context: { name: "discourse_context_", hnuc: "0x275E", pya: "xa" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      prep: "from", // from this text/source
    },

    way: {
      axis: "way",
      case: "evidential_case_",
      hnuc: "0x4937",
      pya: "nwah",
      prep: "according to",
    },

    destination: {
      axis: "destination",
      case: "quotative_case_",
      hnuc: "0x6157",
      pya: "twoh",
      prep: "as", // "in the words of"
    },
  },
};

// Canonical context keywords for Pyash compositional cases.
// Used by Codex and helpers to map high-level prompts or comments
// to the internal context keys used in compositionalGrid.

export const contextKeywords = {
  space: {
    key: "space",
    contextWord: "space_context_",        // from pyashWords.json
    hints: ["space", "spatial", "path", "location", "place", "motion"],
    default: true,                        // default context if none is specified
  },

  interior: {
    key: "interior",
    contextWord: "interior_context_",
    hints: ["inside", "interior", "in", "inward", "room", "container"],
  },

  surface: {
    key: "surface",
    contextWord: "surface_context_",
    hints: ["surface", "on", "top", "table", "floor", "wall"],
  },

  under: {
    key: "under",
    contextWord: "under_context_",
    hints: ["under", "below", "beneath", "subsurface"],
  },

  time: {
    key: "time",
    contextWord: "time_context_",
    hints: ["time", "before", "during", "after", "until", "when"],
  },

  state: {
    key: "state",
    contextWord: "state_context_",
    hints: ["state", "condition", "mode", "type", "representation"],
  },

  person: {
    key: "person",
    contextWord: "person_context_",
    hints: ["person", "agent", "speaker", "listener", "user"],
  },

  social: {
    key: "social",
    contextWord: "social_context_",
    hints: ["group", "community", "social", "organisation", "team"],
  },

  discourse: {
    key: "discourse",
    contextWord: "discourse_context_",
    hints: ["text", "discourse", "quote", "source", "document", "corpus"],
  },
};


export const compositionalByHnuc = Object.fromEntries(
  Object.entries(compositionalGrid).flatMap(([contextKey, ctx]) => {
    return ["source", "way", "destination"].map(axis => {
      const info = ctx[axis];
      return [
        info.hnuc.toLowerCase(),
        {
          context: contextKey,         // "space", "time", "state", ...
          axis: info.axis,             // "source" | "way" | "destination"
          case: info.case,             // e.g. "source_case_"
          pya: info.pya,
          prep: info.prep,
        },
      ];
    });
  })
);

