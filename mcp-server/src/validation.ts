// ─── NHS Research Platform - Query Validation Module ─────────────────────────
// Comprehensive query validation that goes beyond governance pattern-matching.
// Validates column references, semantic correctness, and provides detailed
// feedback to help the AI construct valid queries.

import { getDatasetSchema, getDatasetColumns, validateColumnReference } from "./data-access.js";
import type { ColumnDefinition } from "./data-access.js";
import { researchDatasets } from "./data.js";

// ─── Validation Result Types ────────────────────────────────────────────────

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  suggestion?: string;
}

export interface QueryValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** Parsed elements from the query for feedback */
  parsed: {
    referencedColumns: string[];
    aggregationFunctions: string[];
    groupByColumns: string[];
    filterConditions: string[];
  };
  /** Suggestions to improve the query */
  suggestions: string[];
}

// ─── Prohibited Patterns (Content Governance) ───────────────────────────────

interface ProhibitedPattern {
  pattern: RegExp;
  code: string;
  reason: string;
  suggestion: string;
}

const PROHIBITED_PATTERNS: ProhibitedPattern[] = [
  {
    pattern: /\bnhs\s*number/i,
    code: "PII_NHS_NUMBER",
    reason: "NHS Number is a direct patient identifier and cannot be extracted.",
    suggestion: "Use pseudonymised identifiers (patient_pseudo_id) for cohort-level analysis only.",
  },
  {
    pattern: /\bindividual\s+patient/i,
    code: "PII_INDIVIDUAL",
    reason: "Individual patient-level data extraction is prohibited.",
    suggestion: "Rephrase to ask about aggregate statistics (averages, counts, percentages) across patient groups.",
  },
  {
    pattern: /\bidentif(y|ication)\b.*\bpatient/i,
    code: "PII_IDENTIFICATION",
    reason: "Patient identification queries are not permitted.",
    suggestion: "Focus on population-level patterns rather than identifying specific individuals.",
  },
  {
    pattern: /\bname\b.*\bpatient/i,
    code: "PII_NAME",
    reason: "Patient names are direct identifiers and cannot be queried.",
    suggestion: "Patient names are not stored in research datasets. Use demographic groupings instead.",
  },
  {
    pattern: /\baddress\b.*\bpatient/i,
    code: "PII_ADDRESS",
    reason: "Patient addresses are direct identifiers.",
    suggestion: "Use LSOA-level geography or IMD quintiles for spatial analysis.",
  },
  {
    pattern: /\bdate\s+of\s+birth\b/i,
    code: "PII_DOB",
    reason: "Date of birth combined with other fields may re-identify patients.",
    suggestion: "Use age_band for demographic analysis. Exact dates are not available.",
  },
  {
    pattern: /\bpostcode\b/i,
    code: "PII_POSTCODE",
    reason: "Full postcodes may enable re-identification.",
    suggestion: "Use LSOA codes or IMD quintiles for geographic analysis.",
  },
  {
    pattern: /\bdelete\b|\bdrop\b|\btruncate\b/i,
    code: "DESTRUCTIVE_OP",
    reason: "Destructive operations are not permitted on research data.",
    suggestion: "Research data is read-only. Only SELECT queries are permitted.",
  },
  {
    pattern: /\bupdate\b.*\bset\b/i,
    code: "MODIFY_OP",
    reason: "Data modification is not permitted. Research data is read-only.",
    suggestion: "Research data is immutable. Only analytical SELECT queries are allowed.",
  },
  {
    pattern: /\binsert\b.*\binto\b/i,
    code: "INSERT_OP",
    reason: "Data insertion is not permitted on research datasets.",
    suggestion: "Research data is managed through approved ETL pipelines only.",
  },
  {
    pattern: /\b(select\s+)?\*/i,
    code: "SELECT_STAR",
    reason: "SELECT * may expose identifier columns.",
    suggestion: "Explicitly name the columns you need. Avoid selecting identifier columns directly.",
  },
];

// ─── SQL Aggregation Functions ──────────────────────────────────────────────

const AGG_FUNCTIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX", "MEDIAN", "STDDEV", "VARIANCE", "PERCENTILE"];

// ─── Main Validation Function ───────────────────────────────────────────────

/**
 * Comprehensive query validation that checks:
 * 1. Governance/PII patterns (hard failures)
 * 2. Dataset existence and access
 * 3. Column references validity
 * 4. Aggregation requirements
 * 5. Semantic correctness hints
 */
export function validateQuery(
  naturalLanguageQuery: string,
  datasetId: string,
  options?: { checkColumnsAgainstSQL?: string },
): QueryValidationResult {
  const issues: ValidationIssue[] = [];
  const suggestions: string[] = [];
  const referencedColumns: string[] = [];
  const aggregationFunctions: string[] = [];
  const groupByColumns: string[] = [];
  const filterConditions: string[] = [];

  // ─── 1. Governance Pattern Checks ─────────────────────────────────────
  for (const { pattern, code, reason, suggestion } of PROHIBITED_PATTERNS) {
    if (pattern.test(naturalLanguageQuery)) {
      issues.push({ severity: "error", code, message: reason, suggestion });
    }
  }

  // If there are governance errors, return early - no point checking further
  if (issues.some(i => i.severity === "error")) {
    return {
      valid: false,
      issues,
      parsed: { referencedColumns, aggregationFunctions, groupByColumns, filterConditions },
      suggestions: issues.filter(i => i.suggestion).map(i => i.suggestion!),
    };
  }

  // ─── 2. Dataset Validation ────────────────────────────────────────────
  const dataset = researchDatasets.find(d => d.datasetId === datasetId);
  if (!dataset) {
    issues.push({
      severity: "error",
      code: "DATASET_NOT_FOUND",
      message: `Dataset '${datasetId}' does not exist.`,
      suggestion: `Available datasets: ${researchDatasets.map(d => `${d.datasetId} (${d.name})`).join(", ")}`,
    });
    return {
      valid: false,
      issues,
      parsed: { referencedColumns, aggregationFunctions, groupByColumns, filterConditions },
      suggestions: [],
    };
  }

  const schema = getDatasetSchema(datasetId);
  const columns = getDatasetColumns(datasetId);

  if (!schema || !columns) {
    issues.push({
      severity: "warning",
      code: "NO_SCHEMA",
      message: `No detailed schema available for dataset '${datasetId}'. Column validation skipped.`,
    });
  }

  // ─── 3. SQL Column Validation (if SQL provided) ───────────────────────
  if (options?.checkColumnsAgainstSQL && columns) {
    const sql = options.checkColumnsAgainstSQL;

    // Extract column-like references from SQL
    const columnPattern = /\b([a-z][a-z0-9_]*)\b/gi;
    const sqlTokens = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = columnPattern.exec(sql)) !== null) {
      sqlTokens.add(match[1].toLowerCase());
    }

    // Check each token against known columns
    const knownColumnNames = columns.map(c => c.name.toLowerCase());
    const sqlKeywords = new Set([
      "select",
      "from",
      "where",
      "group",
      "by",
      "order",
      "having",
      "limit",
      "and",
      "or",
      "not",
      "in",
      "between",
      "like",
      "is",
      "null",
      "as",
      "asc",
      "desc",
      "distinct",
      "case",
      "when",
      "then",
      "else",
      "end",
      "join",
      "left",
      "right",
      "inner",
      "outer",
      "on",
      "count",
      "sum",
      "avg",
      "min",
      "max",
      "round",
      "date_trunc",
      "current_date",
      "interval",
      "cast",
      "coalesce",
      "true",
      "false",
    ]);

    for (const token of sqlTokens) {
      if (sqlKeywords.has(token)) continue;
      if (knownColumnNames.includes(token)) {
        referencedColumns.push(token);
        // Check if identifier column is being directly queried
        const col = columns.find(c => c.name.toLowerCase() === token);
        if (col?.isIdentifier) {
          issues.push({
            severity: "error",
            code: "IDENTIFIER_QUERY",
            message: `Column '${col.name}' is a direct identifier and cannot be selected or filtered at row level.`,
            suggestion: `Remove '${col.name}' from your query. For cohort analysis, use GROUP BY on demographic columns.`,
          });
        }
      } else if (token === schema?.tableName?.toLowerCase()) {
        // It's the table name, that's fine
        continue;
      } else if (/^\d+$/.test(token)) {
        // It's a number literal
        continue;
      } else {
        // Unknown token - might be an invalid column reference
        const possibleMatches = knownColumnNames.filter(c => c.includes(token) || token.includes(c));
        if (possibleMatches.length > 0) {
          issues.push({
            severity: "warning",
            code: "POSSIBLE_TYPO",
            message: `'${token}' is not a known column. Did you mean: ${possibleMatches.join(", ")}?`,
          });
        }
      }
    }

    // Check for aggregation functions
    for (const fn of AGG_FUNCTIONS) {
      if (sql.toUpperCase().includes(fn)) {
        aggregationFunctions.push(fn);
      }
    }

    // Check GROUP BY references
    const groupByMatch = sql.match(/GROUP\s+BY\s+(.+?)(?:ORDER|HAVING|LIMIT|$)/is);
    if (groupByMatch) {
      const gbCols = groupByMatch[1].split(",").map(c => c.trim().toLowerCase());
      groupByColumns.push(...gbCols);

      // Validate GROUP BY columns are aggregatable
      for (const gbCol of gbCols) {
        const col = columns.find(c => c.name.toLowerCase() === gbCol);
        if (col && !col.aggregatable) {
          issues.push({
            severity: "warning",
            code: "NON_AGGREGATABLE_GROUP",
            message: `Column '${col.name}' is not recommended for GROUP BY (high cardinality or continuous values).`,
            suggestion: `Consider using one of the recommended grouping columns: ${schema?.suggestedGroupBy.join(", ")}`,
          });
        }
      }
    }

    // Warn if no aggregation is present
    if (aggregationFunctions.length === 0 && !sql.toUpperCase().includes("LIMIT 1")) {
      issues.push({
        severity: "warning",
        code: "NO_AGGREGATION",
        message: "Query does not appear to use aggregation functions. Only aggregate analyses are permitted.",
        suggestion:
          "Add COUNT(), AVG(), SUM(), or similar aggregation functions to ensure results are at population level.",
      });
    }
  }

  // ─── 4. Natural Language Heuristics ───────────────────────────────────
  const queryLower = naturalLanguageQuery.toLowerCase();

  // Check for requests that imply individual-level output
  if (queryLower.includes("list all") || queryLower.includes("show each") || queryLower.includes("every patient")) {
    issues.push({
      severity: "warning",
      code: "INDIVIDUAL_PATTERN",
      message: "Query language suggests individual-level output which may not be permitted.",
      suggestion: "Rephrase to request counts, averages, or distributions rather than individual records.",
    });
  }

  // Check for small-number suppression risk
  if (queryLower.includes("rare") || queryLower.includes("unusual") || queryLower.includes("specific case")) {
    issues.push({
      severity: "info",
      code: "SMALL_NUMBER_RISK",
      message: "Queries targeting rare events may be subject to small number suppression (minimum count of 5).",
    });
  }

  // ─── 5. Generate Helpful Suggestions ──────────────────────────────────
  if (schema && columns) {
    if (groupByColumns.length === 0 && aggregationFunctions.length > 0) {
      suggestions.push(`Consider grouping by: ${schema.suggestedGroupBy.slice(0, 4).join(", ")}`);
    }

    if (schema.qualityNotes.some(n => n.includes("null"))) {
      suggestions.push("Note: Some columns have significant null rates. Consider using COALESCE or filtering nulls.");
    }

    if (dataset.isSynthetic) {
      suggestions.push(
        "This is synthetic data. Results are representative but should not be cited as real clinical evidence.",
      );
    }
  }

  return {
    valid: issues.filter(i => i.severity === "error").length === 0,
    issues,
    parsed: { referencedColumns, aggregationFunctions, groupByColumns, filterConditions },
    suggestions,
  };
}

/**
 * Quick validation check - returns true/false with a reason.
 * Used as a lightweight pre-flight check before full submission.
 */
export function quickValidate(query: string): { safe: boolean; reason?: string } {
  for (const { pattern, reason } of PROHIBITED_PATTERNS) {
    if (pattern.test(query)) {
      return { safe: false, reason };
    }
  }
  return { safe: true };
}

/**
 * Get the list of prohibited patterns for documentation/transparency.
 */
export function getProhibitedPatterns(): Array<{ code: string; description: string; suggestion: string }> {
  return PROHIBITED_PATTERNS.map(p => ({
    code: p.code,
    description: p.reason,
    suggestion: p.suggestion,
  }));
}
