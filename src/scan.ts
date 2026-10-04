import { resolve } from "node:path";
import { detectDeps, detectEnv, detectPlatform, detectSchema } from "./detectors/index.js";
import { buildFindings, EXPOSURE_ORDER } from "./findings.js";
import { mergeLocations } from "./merge.js";
import type { Exposure, ScanResult } from "./types.js";
import { buildContext } from "./walk.js";
import { VERSION } from "./version.js";

export function scan(path: string): ScanResult {
  const root = resolve(path);
  const ctx = buildContext(root);

  const datasets = detectSchema(ctx);
  const locations = mergeLocations([...detectEnv(ctx), ...detectDeps(ctx), ...detectPlatform(ctx)]);
  const findings = buildFindings(locations, datasets);

  const summary = Object.fromEntries(EXPOSURE_ORDER.map((e) => [e, 0])) as Record<Exposure, number>;
  for (const f of findings) summary[f.exposure]++;

  return {
    schemaVersion: 1,
    tool: { name: "residencycheck", version: VERSION },
    root,
    scannedFiles: ctx.files.length,
    datasets,
    locations,
    findings,
    summary,
  };
}
