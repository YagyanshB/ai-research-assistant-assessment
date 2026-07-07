// ─── NHS Research Platform - Data Access Layer ──────────────────────────────
// Provides structured access to dataset schemas, column metadata, preview rows,
// and dataset explanations. Dynamically generated from the JSON mock data.

import type { ResearchDataset } from "./types.js";
import { researchDatasets, sampleQueryResults } from "./data.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, "..", "data");

// ─── Load raw datasets for field info ───────────────────────────────────────

interface RawDataset {
  id: string;
  name: string;
  description: string;
  records: number;
  restricted: boolean;
  fields: string[];
}

const rawDatasets: RawDataset[] = JSON.parse(readFileSync(join(dataDir, "datasets.json"), "utf-8"));

// ─── Column Metadata Types ──────────────────────────────────────────────────

export interface ColumnDefinition {
  name: string;
  type: "string" | "integer" | "float" | "boolean" | "date" | "timestamp" | "text" | "time";
  nullable: boolean;
  description: string;
  isIdentifier: boolean;
  aggregatable: boolean;
  exampleValues: string[];
}

export interface DatasetSchema {
  datasetId: string;
  tableName: string;
  columns: ColumnDefinition[];
  primaryKey: string;
  rowCount: number;
  qualityNotes: string[];
  suggestedGroupBy: string[];
}

// ─── Column Type Inference ──────────────────────────────────────────────────

const COLUMN_METADATA: Record<string, Partial<ColumnDefinition>> = {
  // Demographics
  patient_age: {
    type: "integer",
    description: "Patient age in years",
    aggregatable: true,
    exampleValues: ["41", "55", "72", "83"],
  },
  age: {
    type: "integer",
    description: "Patient age in years",
    aggregatable: true,
    exampleValues: ["34", "58", "72", "84"],
  },
  maternal_age: {
    type: "integer",
    description: "Maternal age at delivery",
    aggregatable: true,
    exampleValues: ["25", "29", "34", "43"],
  },
  sex: { type: "string", description: "Biological sex (M/F)", aggregatable: true, exampleValues: ["M", "F"] },
  ethnicity: {
    type: "string",
    description: "Ethnic group category",
    aggregatable: true,
    exampleValues: ["White British", "Asian British", "Black British", "Mixed", "Other"],
  },
  age_band: {
    type: "string",
    description: "Age group band",
    aggregatable: true,
    exampleValues: ["0-17", "18-30", "31-50", "51-70", "70+"],
  },

  // Clinical measurements
  hba1c: {
    type: "integer",
    description: "HbA1c level in mmol/mol (glycated haemoglobin)",
    aggregatable: false,
    exampleValues: ["49", "58", "67", "85"],
  },
  bmi: {
    type: "float",
    description: "Body Mass Index (kg/m²)",
    aggregatable: false,
    exampleValues: ["23.7", "28.9", "31.2", "37.6"],
  },
  ejection_fraction: {
    type: "integer",
    description: "Left ventricular ejection fraction (%)",
    aggregatable: false,
    exampleValues: ["28", "34", "45", "55"],
  },
  fev1: {
    type: "float",
    description: "Forced Expiratory Volume in 1 second (litres)",
    aggregatable: false,
    exampleValues: ["1.2", "1.4", "1.8", "2.0"],
  },
  fev1_percent_predicted: {
    type: "float",
    description: "FEV1 as percentage of predicted value",
    aggregatable: false,
    exampleValues: ["45", "60", "75", "90"],
  },
  nihss_score: {
    type: "integer",
    description: "NIH Stroke Scale score (0-42)",
    aggregatable: false,
    exampleValues: ["4", "6", "14", "22"],
  },
  rockwood_score: {
    type: "integer",
    description: "Clinical Frailty Scale / Rockwood score (1-9)",
    aggregatable: true,
    exampleValues: ["1", "3", "6", "9"],
  },
  lactate: {
    type: "float",
    description: "Serum lactate level (mmol/L)",
    aggregatable: false,
    exampleValues: ["1.2", "2.5", "3.8", "5.1"],
  },
  sofa_score: {
    type: "integer",
    description: "Sequential Organ Failure Assessment score",
    aggregatable: false,
    exampleValues: ["2", "5", "7", "10"],
  },
  apache_ii_score: {
    type: "integer",
    description: "APACHE II severity of disease score (0-71)",
    aggregatable: false,
    exampleValues: ["8", "15", "22", "35"],
  },
  egfr: {
    type: "integer",
    description: "Estimated Glomerular Filtration Rate (mL/min/1.73m²)",
    aggregatable: false,
    exampleValues: ["15", "30", "60", "90"],
  },
  creatinine: {
    type: "float",
    description: "Serum creatinine level (µmol/L)",
    aggregatable: false,
    exampleValues: ["80", "120", "250", "450"],
  },
  fatigue_score: {
    type: "integer",
    description: "Fatigue severity score",
    aggregatable: false,
    exampleValues: ["2", "5", "7", "9"],
  },
  health_outcome_score: {
    type: "float",
    description: "Composite health outcome score",
    aggregatable: false,
    exampleValues: ["0.3", "0.5", "0.7", "0.9"],
  },
  life_expectancy: {
    type: "float",
    description: "Life expectancy estimate in years",
    aggregatable: false,
    exampleValues: ["72.5", "78.2", "82.1", "85.6"],
  },
  birth_weight: {
    type: "float",
    description: "Birth weight in kg",
    aggregatable: false,
    exampleValues: ["2.5", "3.0", "3.4", "4.2"],
  },

  // Categorical
  medication: {
    type: "string",
    description: "Prescribed medication type",
    aggregatable: true,
    exampleValues: ["ACE inhibitor", "beta-blocker", "diuretic", "statin"],
  },
  outcome: {
    type: "string",
    description: "Clinical outcome category",
    aggregatable: true,
    exampleValues: ["stable", "improved", "readmitted", "deceased"],
  },
  smoking_status: {
    type: "string",
    description: "Smoking status category",
    aggregatable: true,
    exampleValues: ["current", "ex-smoker", "never"],
  },
  tumour_type: {
    type: "string",
    description: "Cancer tumour type",
    aggregatable: true,
    exampleValues: ["breast", "lung", "prostate", "colorectal", "bladder"],
  },
  stage: {
    type: "string",
    description: "Cancer staging (TNM)",
    aggregatable: true,
    exampleValues: ["I", "II", "III", "IV"],
  },
  treatment: {
    type: "string",
    description: "Treatment modality",
    aggregatable: true,
    exampleValues: ["surgery", "chemotherapy", "radiotherapy", "immunotherapy"],
  },
  stroke_type: {
    type: "string",
    description: "Type of stroke",
    aggregatable: true,
    exampleValues: ["ischaemic", "haemorrhagic", "TIA"],
  },
  discharge_destination: {
    type: "string",
    description: "Discharge destination after admission",
    aggregatable: true,
    exampleValues: ["home", "rehab", "nursing_home", "died"],
  },
  disposition: {
    type: "string",
    description: "Patient disposition from A&E",
    aggregatable: true,
    exampleValues: ["admitted", "discharged", "left_without_being_seen", "referred"],
  },
  triage_category: {
    type: "integer",
    description: "Manchester Triage category (1-5)",
    aggregatable: true,
    exampleValues: ["1", "2", "3", "4", "5"],
  },
  diagnosis_category: {
    type: "string",
    description: "Primary diagnosis category",
    aggregatable: true,
    exampleValues: ["anxiety", "depression", "psychosis", "PTSD", "OCD"],
  },
  referral_source: {
    type: "string",
    description: "Source of referral",
    aggregatable: true,
    exampleValues: ["GP", "A&E", "self-referral", "police"],
  },
  crisis_flag: {
    type: "boolean",
    description: "Whether flagged as crisis presentation",
    aggregatable: true,
    exampleValues: ["true", "false"],
  },
  care_setting: {
    type: "string",
    description: "Care setting at assessment",
    aggregatable: true,
    exampleValues: ["community", "residential", "nursing_home", "hospital"],
  },
  delivery_type: {
    type: "string",
    description: "Type of delivery",
    aggregatable: true,
    exampleValues: ["vaginal", "caesarean", "instrumental"],
  },
  dialysis_status: {
    type: "string",
    description: "Current dialysis status",
    aggregatable: true,
    exampleValues: ["none", "haemodialysis", "peritoneal", "transplant_listed"],
  },
  specialty: {
    type: "string",
    description: "Medical specialty",
    aggregatable: true,
    exampleValues: ["Orthopaedics", "Cardiology", "General Surgery", "Ophthalmology"],
  },
  referral_priority: {
    type: "string",
    description: "Referral priority level",
    aggregatable: true,
    exampleValues: ["routine", "urgent", "two_week_wait"],
  },
  breach_flag: {
    type: "boolean",
    description: "Whether RTT 18-week standard breached",
    aggregatable: true,
    exampleValues: ["true", "false"],
  },
  vaccine_type: {
    type: "string",
    description: "Vaccine type administered",
    aggregatable: true,
    exampleValues: ["COVID-19", "Influenza", "Pneumococcal", "Shingles"],
  },
  dose_number: {
    type: "integer",
    description: "Dose number in series",
    aggregatable: true,
    exampleValues: ["1", "2", "3", "4"],
  },
  uptake_status: {
    type: "string",
    description: "Vaccination uptake status",
    aggregatable: true,
    exampleValues: ["completed", "partial", "declined", "not_offered"],
  },
  drug_class: {
    type: "string",
    description: "Medication drug class",
    aggregatable: true,
    exampleValues: ["anticoagulant", "opioid", "insulin", "antibiotic", "NSAID"],
  },
  incident_type: {
    type: "string",
    description: "Type of medication incident",
    aggregatable: true,
    exampleValues: ["wrong_dose", "omission", "wrong_drug", "wrong_route"],
  },
  severity: {
    type: "string",
    description: "Incident severity level",
    aggregatable: true,
    exampleValues: ["no_harm", "low", "moderate", "severe"],
  },
  device_type: {
    type: "string",
    description: "Remote monitoring device type",
    aggregatable: true,
    exampleValues: ["blood_pressure", "glucose", "pulse_oximeter", "weight_scale"],
  },
  mortality: {
    type: "boolean",
    description: "In-hospital mortality flag",
    aggregatable: true,
    exampleValues: ["true", "false"],
  },
  return_to_work: {
    type: "boolean",
    description: "Whether patient returned to work",
    aggregatable: true,
    exampleValues: ["true", "false"],
  },
  imd_decile: {
    type: "integer",
    description: "Index of Multiple Deprivation decile (1=most deprived)",
    aggregatable: true,
    exampleValues: ["1", "3", "5", "8", "10"],
  },
  region: {
    type: "string",
    description: "Geographic region",
    aggregatable: true,
    exampleValues: ["North", "South", "East", "West", "Central"],
  },

  // Time & Duration
  arrival_time: {
    type: "time",
    description: "Time of arrival (HH:MM)",
    aggregatable: false,
    exampleValues: ["08:12", "14:03", "22:46", "01:25"],
  },
  wait_minutes: {
    type: "integer",
    description: "Wait time in minutes",
    aggregatable: false,
    exampleValues: ["20", "45", "90", "177"],
  },
  wait_weeks: {
    type: "integer",
    description: "Wait time in weeks",
    aggregatable: false,
    exampleValues: ["4", "12", "26", "52"],
  },
  time_to_antibiotics_mins: {
    type: "integer",
    description: "Time from presentation to antibiotic administration (minutes)",
    aggregatable: false,
    exampleValues: ["25", "42", "68", "120"],
  },
  survival_months: {
    type: "integer",
    description: "Survival duration in months",
    aggregatable: false,
    exampleValues: ["8", "22", "48", "87"],
  },
  length_of_stay: {
    type: "integer",
    description: "ICU length of stay in days",
    aggregatable: false,
    exampleValues: ["2", "5", "12", "28"],
  },
  exacerbations_per_year: {
    type: "integer",
    description: "Number of exacerbations per year",
    aggregatable: true,
    exampleValues: ["0", "1", "3", "5"],
  },
  exacerbations: {
    type: "integer",
    description: "Number of exacerbations",
    aggregatable: true,
    exampleValues: ["0", "1", "2", "4"],
  },
  falls_count: {
    type: "integer",
    description: "Number of falls in past 12 months",
    aggregatable: false,
    exampleValues: ["0", "2", "4", "7"],
  },
  gestation_weeks: {
    type: "integer",
    description: "Gestational age in weeks at delivery",
    aggregatable: true,
    exampleValues: ["33", "35", "37", "39", "41"],
  },
  symptom_duration_weeks: {
    type: "integer",
    description: "Duration of symptoms in weeks",
    aggregatable: false,
    exampleValues: ["4", "12", "24", "52"],
  },
  inhaler_adherence: {
    type: "float",
    description: "Inhaler adherence rate (%)",
    aggregatable: false,
    exampleValues: ["40", "65", "80", "95"],
  },
  adherence_percent: {
    type: "float",
    description: "Device adherence percentage",
    aggregatable: false,
    exampleValues: ["30", "55", "75", "92"],
  },
  alert_count: {
    type: "integer",
    description: "Number of clinical alerts generated",
    aggregatable: false,
    exampleValues: ["0", "3", "8", "15"],
  },
};

// ─── Build Schemas Dynamically ──────────────────────────────────────────────

function buildSchema(raw: RawDataset): DatasetSchema {
  const columns: ColumnDefinition[] = raw.fields.map(fieldName => {
    const meta = COLUMN_METADATA[fieldName];
    return {
      name: fieldName,
      type: meta?.type ?? "string",
      nullable: false,
      description: meta?.description ?? fieldName.replace(/_/g, " "),
      isIdentifier: false,
      aggregatable: meta?.aggregatable ?? false,
      exampleValues: meta?.exampleValues ?? [],
    };
  });

  const suggestedGroupBy = columns.filter(c => c.aggregatable).map(c => c.name);

  return {
    datasetId: raw.id,
    tableName: raw.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+$/, ""),
    columns,
    primaryKey: "record_id",
    rowCount: raw.records,
    qualityNotes: [
      "Synthetic data generated for research demonstration purposes",
      raw.restricted
        ? "Restricted dataset - requires elevated access tier"
        : "Standard classification - accessible to all approved researchers",
    ],
    suggestedGroupBy,
  };
}

const datasetSchemas: Record<string, DatasetSchema> = {};
for (const raw of rawDatasets) {
  datasetSchemas[raw.id] = buildSchema(raw);
}

// ─── Data Access Functions ──────────────────────────────────────────────────

export function getDatasetSchema(datasetId: string): DatasetSchema | null {
  return datasetSchemas[datasetId] ?? null;
}

export function getDatasetColumns(datasetId: string): ColumnDefinition[] | null {
  const schema = datasetSchemas[datasetId];
  return schema ? schema.columns : null;
}

export function getDatasetPreview(datasetId: string, limit: number = 5): Record<string, unknown>[] | null {
  const result = sampleQueryResults[datasetId];
  if (!result) return null;
  return result.rows.slice(0, Math.min(limit, result.rows.length));
}

export function getDatasetMetadata(datasetId: string): ResearchDataset | null {
  return researchDatasets.find(d => d.datasetId === datasetId) ?? null;
}

export function explainDataset(datasetId: string): string | null {
  const schema = datasetSchemas[datasetId];
  const metadata = getDatasetMetadata(datasetId);
  if (!schema || !metadata) return null;

  const aggregatableCols = schema.columns.filter(c => c.aggregatable);
  const metricCols = schema.columns.filter(c => !c.aggregatable);

  let explanation = `# Dataset: ${metadata.name}\n\n`;
  explanation += `## Overview\n`;
  explanation += `${metadata.description}\n\n`;
  explanation += `- **Dataset ID:** \`${datasetId}\`\n`;
  explanation += `- **Table Name:** \`${schema.tableName}\`\n`;
  explanation += `- **Records:** ${schema.rowCount.toLocaleString()}\n`;
  explanation += `- **Classification:** ${metadata.classificationLevel}\n`;
  explanation += `- **Category:** ${metadata.dataCategory}\n`;
  explanation += `- **Synthetic:** ${metadata.isSynthetic ? "Yes" : "No"}\n`;
  explanation += `- **Owner:** ${metadata.dataOwner}\n`;
  explanation += `- **Last Updated:** ${metadata.lastUpdated}\n`;
  explanation += `- **Retention:** ${metadata.retentionPolicy}\n\n`;

  explanation += `## Fields (${schema.columns.length})\n\n`;
  for (const col of schema.columns) {
    explanation += `- **\`${col.name}\`** (${col.type}) — ${col.description}`;
    if (col.aggregatable) explanation += ` [groupable]`;
    explanation += `\n`;
    if (col.exampleValues.length > 0) {
      explanation += `  Values: ${col.exampleValues.join(", ")}\n`;
    }
  }

  explanation += `\n## Recommended Grouping Columns\n`;
  explanation += aggregatableCols.map(c => `- \`${c.name}\``).join("\n");
  explanation += `\n\n`;

  explanation += `## Metric Columns (use with AVG/SUM/COUNT)\n`;
  explanation += metricCols.map(c => `- \`${c.name}\` — ${c.description}`).join("\n");
  explanation += `\n\n`;

  explanation += `## Data Quality Notes\n`;
  explanation += schema.qualityNotes.map(n => `- ${n}`).join("\n");
  explanation += `\n\n`;

  explanation += `## Governance Constraints\n`;
  explanation += `- Only aggregate queries are permitted (no individual record extraction)\n`;
  explanation += `- Results must not be reportable to fewer than 5 individuals\n`;
  if (metadata.classificationLevel === "Official - Sensitive") {
    explanation += `- ⚠️ This dataset is RESTRICTED: requires Tier 2+ access, all queries logged\n`;
  }

  return explanation;
}

export function validateColumnReference(
  datasetId: string,
  columnName: string,
): {
  valid: boolean;
  column?: ColumnDefinition;
  reason?: string;
} {
  const schema = datasetSchemas[datasetId];
  if (!schema) return { valid: false, reason: `Dataset '${datasetId}' not found.` };

  const column = schema.columns.find(c => c.name === columnName);
  if (!column) {
    const similar = schema.columns
      .filter(c => c.name.includes(columnName) || columnName.includes(c.name))
      .map(c => c.name);
    return {
      valid: false,
      reason: `Column '${columnName}' not found in ${schema.tableName}. Available: ${schema.columns.map(c => c.name).join(", ")}${similar.length > 0 ? `. Did you mean: ${similar.join(", ")}?` : ""}`,
    };
  }

  return { valid: true, column };
}

export function getAvailableDatasetIds(): string[] {
  return Object.keys(datasetSchemas);
}
