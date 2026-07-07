// src/data/registry.js
//
// Single source of truth for topic unlock order (D-005 §3). Extracted from
// src/hooks/useProgress.js, which previously defined TOPIC_UNLOCK_ORDER
// inline. topics_catalog.position (seeded by scripts/content/seed.mjs) is
// derived from the index of each topic id in this array. C2 also consumes
// this same export when it generates DEFAULT_PROGRESS — coordinate nothing,
// just export it (per the H1 chunk spec).

export const TOPIC_UNLOCK_ORDER = [
  'immigration',
  'taxes',
  'gerrymandering',
  'gunRights',
  'climateChange',
]
