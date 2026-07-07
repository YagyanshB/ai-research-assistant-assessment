// ─── NHS Research Platform - Data Layer ──────────────────────────────────────
// Loads mock data from JSON files for the live demonstration.
// In production, these would be backed by a database or API.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { ResearchProject, ResearchDataset, AuditLogEntry } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, "..", "data");

// ─── Load JSON Data ─────────────────────────────────────────────────────────

interface RawDataset {
  id: string;
  name: string;
  description: string;
  records: number;
  restricted: boolean;
  fields: string[];
}

interface RawProject {
  id: string;
  name: string;
  lead: string;
  status: string;
  dataset: string;
  description: string;
}

export interface Researcher {
  username: string;
  display_name: string;
  role: string;
  projects: string[];
}

export interface SampleQueryResult {
  count: number;
  rows: Record<string, unknown>[];
}

const rawDatasets: RawDataset[] = JSON.parse(readFileSync(join(dataDir, "datasets.json"), "utf-8"));
const rawProjects: RawProject[] = JSON.parse(readFileSync(join(dataDir, "projects.json"), "utf-8"));
export const researchers: Researcher[] = JSON.parse(readFileSync(join(dataDir, "researchers.json"), "utf-8"));
export const sampleQueryResults: Record<string, SampleQueryResult> = JSON.parse(
  readFileSync(join(dataDir, "sample_query_results.json"), "utf-8"),
);

// ─── Transform to Domain Types ──────────────────────────────────────────────

export const researchProjects: ResearchProject[] = rawProjects.map(p => ({
  projectId: p.id,
  title: p.name,
  description: p.description,
  principalInvestigator: p.lead,
  status: p.status === "active" ? ("Active" as const) : ("Completed" as const),
  approvalDate: "2024-01-15",
  expiryDate: "2026-01-14",
  ethicsReference: `IRAS-2024-${p.id.replace("PRJ", "").padStart(6, "0")}`,
  fundingBody: "NHS England",
  researchDomain: getDomainForProject(p.id),
  accessTier: getAccessTierForDataset(p.dataset),
}));

export const researchDatasets: ResearchDataset[] = rawDatasets.map(d => ({
  datasetId: d.id,
  name: d.name,
  description: d.description,
  classificationLevel: d.restricted ? ("Official - Sensitive" as const) : ("Official" as const),
  dataOwner: "NHS Regional Research Platform",
  recordCount: d.records,
  lastUpdated: "2025-03-01",
  dataCategory: getCategoryForDataset(d.id),
  isSynthetic: true,
  retentionPolicy: "5 years post-study",
  projectId: `PRJ${d.id.replace("DS", "")}`,
}));

// ─── Audit Log (mutable, grows during session) ─────────────────────────────

export const auditLog: AuditLogEntry[] = [
  {
    entryId: "audit-001",
    timestamp: "2025-03-12T09:00:00.000Z",
    userId: "diana",
    toolName: "searchDatasets",
    action: "Search Datasets",
    resourceType: "Dataset",
    resourceId: null,
    outcome: "Success",
    details: "Searched for diabetes-related datasets. Returned 1 result.",
    ipAddress: "10.0.1.45",
    projectId: "PRJ001",
  },
  {
    entryId: "audit-002",
    timestamp: "2025-03-12T09:05:00.000Z",
    userId: "nina",
    toolName: "submitQuery",
    action: "Submit Analytical Query",
    resourceType: "AnalyticalQuery",
    resourceId: "q-001",
    outcome: "Success",
    details: "Executed query against Heart Failure Registry.",
    ipAddress: "10.0.2.12",
    projectId: "PRJ002",
  },
  {
    entryId: "audit-003",
    timestamp: "2025-03-11T16:20:00.000Z",
    userId: "charlie",
    toolName: "submitQuery",
    action: "Submit Analytical Query",
    resourceType: "AnalyticalQuery",
    resourceId: "q-005",
    outcome: "Rejected",
    details: "Query rejected - attempted patient identification.",
    ipAddress: "10.0.3.8",
    projectId: "PRJ015",
  },
];

// ─── Analytical Queries ─────────────────────────────────────────────────────

export interface AnalyticalQuery {
  queryId: string;
  naturalLanguageQuery: string;
  translatedQuery: string | null;
  status: "Pending" | "Approved" | "Rejected";
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resultSummary: string | null;
  datasetId: string;
  projectId: string;
  rejectionReason: string | null;
}

export const analyticalQueries: AnalyticalQuery[] = [
  {
    queryId: "q-001",
    naturalLanguageQuery: "What is the average HbA1c by ethnicity in the diabetes cohort?",
    translatedQuery:
      "SELECT ethnicity, AVG(hba1c) AS avg_hba1c, COUNT(*) AS n FROM ds001_diabetes GROUP BY ethnicity ORDER BY avg_hba1c DESC",
    status: "Approved",
    submittedBy: "Diana Fitzgerald",
    submittedAt: "2025-03-01T09:30:00.000Z",
    reviewedBy: "Platform Admin",
    reviewedAt: "2025-03-01T10:15:00.000Z",
    resultSummary:
      "Mean HbA1c ranges from 54 mmol/mol (Asian British) to 72 mmol/mol (Black British). Significant variation by ethnicity suggests targeted intervention needed.",
    datasetId: "DS001",
    projectId: "PRJ001",
    rejectionReason: null,
  },
  {
    queryId: "q-002",
    naturalLanguageQuery: "Show the distribution of ejection fraction by medication type in heart failure patients",
    translatedQuery:
      "SELECT medication, AVG(ejection_fraction) AS avg_ef, COUNT(*) AS n FROM ds002_heart_failure GROUP BY medication",
    status: "Approved",
    submittedBy: "Nina Kapoor",
    submittedAt: "2025-02-20T14:00:00.000Z",
    reviewedBy: "Platform Admin",
    reviewedAt: "2025-02-20T15:30:00.000Z",
    resultSummary:
      "Patients on ACE inhibitors show higher mean EF (34%) vs beta-blockers (28%). Both groups show improvement over baseline.",
    datasetId: "DS002",
    projectId: "PRJ002",
    rejectionReason: null,
  },
  {
    queryId: "q-003",
    naturalLanguageQuery: "Compare survival months across tumour types and stages",
    translatedQuery:
      "SELECT tumour_type, stage, AVG(survival_months) AS avg_survival, COUNT(*) AS n FROM ds004_cancer GROUP BY tumour_type, stage ORDER BY tumour_type, stage",
    status: "Approved",
    submittedBy: "Hannah Price",
    submittedAt: "2025-03-05T11:00:00.000Z",
    reviewedBy: "George Palmer",
    reviewedAt: "2025-03-05T11:45:00.000Z",
    resultSummary:
      "Breast cancer Stage I shows best survival (57 months avg). Lung cancer Stage IV poorest prognosis. Immunotherapy improving outcomes in bladder cancer.",
    datasetId: "DS004",
    projectId: "PRJ004",
    rejectionReason: null,
  },
  {
    queryId: "q-004",
    naturalLanguageQuery: "What is the average wait time by triage category in A&E?",
    translatedQuery:
      "SELECT triage_category, AVG(wait_minutes) AS avg_wait, COUNT(*) AS n FROM ds006_emergency GROUP BY triage_category ORDER BY triage_category",
    status: "Approved",
    submittedBy: "Diana Fitzgerald",
    submittedAt: "2025-03-10T08:45:00.000Z",
    reviewedBy: "Platform Admin",
    reviewedAt: "2025-03-10T09:00:00.000Z",
    resultSummary:
      "Category 1 (immediate): 139 min avg wait. Category 2: 107 min. Category 3: 120 min. Category 4-5: 81-135 min. Significant 4-hour breach risk.",
    datasetId: "DS006",
    projectId: "PRJ006",
    rejectionReason: null,
  },
  {
    queryId: "q-005",
    naturalLanguageQuery: "Identify individual patient NHS numbers from the diabetes cohort with high HbA1c",
    translatedQuery: null,
    status: "Rejected",
    submittedBy: "Charlie Ramirez",
    submittedAt: "2025-03-08T16:20:00.000Z",
    reviewedBy: "Information Governance Officer",
    reviewedAt: "2025-03-08T16:25:00.000Z",
    resultSummary: null,
    datasetId: "DS001",
    projectId: "PRJ001",
    rejectionReason:
      "Query attempts to identify individual patients. Only aggregate analyses are permitted. NHS Number is a direct identifier and cannot be extracted.",
  },
  {
    queryId: "q-006",
    naturalLanguageQuery: "What proportion of mental health referrals are flagged as crisis by referral source?",
    translatedQuery:
      "SELECT referral_source, COUNT(*) AS total, SUM(CASE WHEN crisis_flag THEN 1 ELSE 0 END) AS crisis_count, ROUND(AVG(CASE WHEN crisis_flag THEN 1.0 ELSE 0.0 END) * 100, 1) AS crisis_pct FROM ds007_mental_health GROUP BY referral_source",
    status: "Approved",
    submittedBy: "Alice Nguyen",
    submittedAt: "2025-03-06T10:00:00.000Z",
    reviewedBy: "Mike Sinclair",
    reviewedAt: "2025-03-06T10:30:00.000Z",
    resultSummary:
      "A&E referrals have highest crisis rate (50%). Police referrals 33% crisis. GP and self-referral lower crisis rates (~25%).",
    datasetId: "DS007",
    projectId: "PRJ007",
    rejectionReason: null,
  },
];

// ─── Helper Functions ───────────────────────────────────────────────────────

function getDomainForProject(projectId: string): string {
  const domains: Record<string, string> = {
    PRJ001: "Diabetes & Endocrinology",
    PRJ002: "Cardiology",
    PRJ003: "Respiratory Medicine",
    PRJ004: "Oncology",
    PRJ005: "Neurology & Stroke",
    PRJ006: "Emergency Medicine",
    PRJ007: "Mental Health",
    PRJ008: "Geriatrics & Frailty",
    PRJ009: "Maternity & Obstetrics",
    PRJ010: "Critical Care & Sepsis",
    PRJ011: "Nephrology",
    PRJ012: "Population Health",
    PRJ013: "Elective Care",
    PRJ014: "Public Health & Vaccination",
    PRJ015: "Health Inequalities",
    PRJ016: "Long COVID / Post-COVID",
    PRJ017: "Respiratory Medicine",
    PRJ018: "Pharmacy & Medication Safety",
    PRJ019: "Critical Care",
    PRJ020: "Digital Health & Remote Monitoring",
  };
  return domains[projectId] ?? "General Research";
}

function getAccessTierForDataset(datasetId: string): "Tier 1" | "Tier 2" | "Tier 3" {
  const dataset = rawDatasets.find(d => d.id === datasetId);
  if (!dataset) return "Tier 1";
  if (dataset.restricted) return "Tier 2";
  return "Tier 1";
}

function getCategoryForDataset(datasetId: string): string {
  const categories: Record<string, string> = {
    DS001: "Primary Care",
    DS002: "Cardiology",
    DS003: "Respiratory",
    DS004: "Oncology",
    DS005: "Neurology",
    DS006: "Emergency Care",
    DS007: "Mental Health",
    DS008: "Geriatrics",
    DS009: "Maternity",
    DS010: "Acute Care",
    DS011: "Nephrology",
    DS012: "Population Health",
    DS013: "Elective Care",
    DS014: "Public Health",
    DS015: "Health Inequalities",
    DS016: "Post-COVID",
    DS017: "Respiratory",
    DS018: "Pharmacy",
    DS019: "Critical Care",
    DS020: "Digital Health",
  };
  return categories[datasetId] ?? "General";
}
