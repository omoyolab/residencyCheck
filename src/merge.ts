import type { Detected } from "./detectors/index.js";
import type { Evidence, Location, LocationConfidence } from "./types.js";

const RANK: Record<LocationConfidence, number> = { UNKNOWN: 0, INFERRED: 1, DECLARED: 2, KNOWN: 3 };

/**
 * Collapse per-detector sightings into one Location per real service.
 * Within a provider+kind group, a weaker sighting folds into a stronger one when
 * it's the same service (e.g. `@sentry/node` in package.json + SENTRY_DSN in .env)
 * or has no location of its own. Distinct located services are never merged.
 */
export function mergeLocations(detected: Detected[]): Location[] {
  const concreteKinds = new Set(detected.filter((d) => !d.generic).map((d) => d.kind));
  const kept = detected.filter((d) => !d.generic || !concreteKinds.has(d.kind));

  const groups = new Map<string, Detected[]>();
  for (const d of kept) {
    const key = `${d.provider}|${d.kind}|${d.role ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  let merged: Location[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => RANK[b.locationConfidence] - RANK[a.locationConfidence]);
    const result: Location[] = [];
    for (const d of sorted) {
      const { generic: _generic, ...loc } = d;
      const weaker = (p: Location) => RANK[loc.locationConfidence] < RANK[p.locationConfidence];
      const same = result.find((p) => p.service === loc.service && (p.region === loc.region || weaker(p)));
      if (same) {
        same.evidence.push(...loc.evidence);
      } else if (!loc.country && result[0] && weaker(result[0])) {
        result[0].evidence.push(...loc.evidence);
      } else {
        result.push({ ...loc, evidence: [...loc.evidence] });
      }
    }
    merged.push(...result);
  }

  merged = applyAwsDefaultRegion(merged);
  for (const loc of merged) loc.evidence = dedupeEvidence(loc.evidence);
  return merged;
}

/** AWS services with no region of their own take AWS_REGION; the bare default-region entry then folds into them. */
function applyAwsDefaultRegion(locations: Location[]): Location[] {
  const defaults = locations.find((l) => l.provider === "AWS" && l.kind === "cloud" && l.region);
  if (!defaults) return locations;
  const others = locations.filter((l) => l.provider === "AWS" && l !== defaults);
  for (const l of others) {
    if (!l.region) {
      l.region = defaults.region;
      l.country = defaults.country;
      l.locationConfidence = defaults.country ? "INFERRED" : "UNKNOWN";
      l.note = "Region taken from the AWS default region setting.";
    }
    l.evidence.push(...defaults.evidence);
  }
  return others.length ? locations.filter((l) => l !== defaults) : locations;
}

function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((e) => {
    const key = `${e.file}:${e.line ?? ""}:${e.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
