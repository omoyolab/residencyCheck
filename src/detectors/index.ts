import type { Location } from "../types.js";

/** A location as reported by a single detector, before merging. */
export type Detected = Location & { generic?: boolean };

export { detectEnv } from "./env.js";
export { detectDeps } from "./deps.js";
export { detectPlatform } from "./platform.js";
export { detectSchema } from "./schema.js";
export { detectTerraform } from "./terraform.js";
