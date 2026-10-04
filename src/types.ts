// Three axes that are deliberately kept separate (SPEC.md §2):
//   where a service is        → LocationConfidence
//   what data is involved     → PaymentRelevance
//   our reading against ¶2    → Exposure

export type LocationConfidence = "KNOWN" | "INFERRED" | "DECLARED" | "UNKNOWN";
export type PaymentRelevance = "HIGH" | "MEDIUM" | "LOW";
export type Exposure = "CLEAR" | "LIKELY" | "UNCLEAR" | "VERIFY" | "INFO";

export type ServiceKind =
  | "database"
  | "storage"
  | "cache"
  | "queue"
  | "error-tracking"
  | "logging"
  | "analytics"
  | "messaging"
  | "hosting"
  | "cloud"
  | "payments";

export interface Evidence {
  file: string;
  line?: number;
  /** Redacted. Never contains credentials. */
  snippet: string;
}

export interface Location {
  provider: string;
  service: string;
  kind: ServiceKind;
  region?: string;
  /** ISO 3166-1 alpha-2, or "EU". Undefined when unknown. */
  country?: string;
  locationConfidence: LocationConfidence;
  evidence: Evidence[];
  note?: string;
}

export interface Dataset {
  name: string;
  relevance: PaymentRelevance;
  /** Columns that drove the classification. */
  signals: string[];
  evidence: Evidence;
}

export interface Finding {
  id: string;
  title: string;
  exposure: Exposure;
  paymentRelevance: PaymentRelevance;
  location: Location;
  datasets: Dataset[];
  why: string;
  remediation: string[];
  citation: string;
}

export interface ScanResult {
  schemaVersion: 1;
  tool: { name: string; version: string };
  root: string;
  scannedFiles: number;
  datasets: Dataset[];
  locations: Location[];
  findings: Finding[];
  summary: Record<Exposure, number>;
}
