// scripts/content/domain-utils.mjs
//
// Shared registrable-domain matching used by lint-sources.mjs (and its
// fixture tests). Zero-dep by design (BUILD_PLAN §1 — no npm deps without
// operator approval; a full public-suffix-list library is overkill for the
// handful of source domains actually cited in content).
//
// "Registrable domain" here means: an allowlist entry like "npr.org"
// matches the hostname "npr.org" itself AND any subdomain of it
// ("www.npr.org", "text.npr.org"), per the H1 spec's "matched on
// registrable domain (subdomains of an allowlisted domain pass)".
//
// This is deliberately a simple suffix match, not a full public-suffix-list
// implementation — every domain actually seeded in source-tiers.json is a
// plain second-level registrable domain (e.g. "apnews.com", "npr.org"), so
// this is sufficient for this content set. If a future allowlist entry is
// itself a public suffix (e.g. "co.uk"), this would over-match; flagged here
// rather than silently assumed away.

export function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function domainMatches(hostname, allowedDomain) {
  const h = hostname.toLowerCase()
  const d = allowedDomain.toLowerCase()
  return h === d || h.endsWith(`.${d}`)
}

// Returns the first entry in `domainList` that `hostname` matches, or null.
export function findMatchingDomain(hostname, domainList) {
  return domainList.find((d) => domainMatches(hostname, d)) ?? null
}
