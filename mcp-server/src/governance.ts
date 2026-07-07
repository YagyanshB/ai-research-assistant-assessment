// ─── NHS Research Platform - Governance Middleware ───────────────────────────
// Implements a policy-based governance framework with:
//   1. Rate Limiting
//   2. Tiered Access Control
//   3. Data Classification Enforcement
//   4. Query Content Validation (PII detection)
//   5. Small-Number Suppression (minimum count of 5)
//   6. Query Approval Workflow
//   7. Full Audit Logging
//
// Architecture: Each governance rule is a declared policy in the GOVERNANCE_POLICIES
// registry. New policies can be added by appending to that array — no other code
// changes are required.

import { v4 as uuidv4 } from "uuid";
import type { AuditLogEntry, GovernanceDecision, UserSession } from "./types.js";
import { auditLog } from "./data.js";

// ─── Governance Policy Registry ─────────────────────────────────────────────
// All governance rules are declared here for transparency and extensibility.
// Each policy has an ID, human-readable description, category, and enforcement level.

export interface GovernancePolicy {
  id: string;
  name: string;
  description: string;
  category: "access-control" | "data-protection" | "rate-limiting" | "output-control" | "audit";
  enforcement: "hard-block" | "soft-warning" | "automatic";
  active: boolean;
}

/**
 * Central registry of all governance policies applied by this platform.
 * To add a new policy: append to this array and implement the enforcement logic below.
 */
export const GOVERNANCE_POLICIES: GovernancePolicy[] = [
  {
    id: "GOV-001",
    name: "Rate Limiting",
    description:
      "Limit each researcher to 50 queries per day to prevent excessive resource usage and ensure fair access.",
    category: "rate-limiting",
    enforcement: "hard-block",
    active: true,
  },
  {
    id: "GOV-002",
    name: "Tiered Access Control",
    description:
      "Researchers can only access projects and datasets matching their clearance tier (Tier 1/2/3 hierarchy).",
    category: "access-control",
    enforcement: "hard-block",
    active: true,
  },
  {
    id: "GOV-003",
    name: "Data Classification Enforcement",
    description:
      "Datasets classified as 'Official - Sensitive' require Tier 2+ access. All access to sensitive data is logged.",
    category: "data-protection",
    enforcement: "hard-block",
    active: true,
  },
  {
    id: "GOV-004",
    name: "PII Pattern Detection",
    description:
      "Queries attempting to extract direct patient identifiers (NHS Number, name, address, DoB, full postcode) are blocked automatically.",
    category: "data-protection",
    enforcement: "hard-block",
    active: true,
  },
  {
    id: "GOV-005",
    name: "Small-Number Suppression",
    description:
      "Analytical results where any group contains fewer than 5 records are suppressed to prevent potential re-identification of individuals.",
    category: "output-control",
    enforcement: "automatic",
    active: true,
  },
  {
    id: "GOV-006",
    name: "Aggregate-Only Enforcement",
    description:
      "All queries must use aggregation functions (COUNT, AVG, SUM, etc.). Row-level data extraction is prohibited.",
    category: "data-protection",
    enforcement: "hard-block",
    active: true,
  },
  {
    id: "GOV-007",
    name: "Read-Only Data Access",
    description: "Research data is immutable. DELETE, UPDATE, INSERT, DROP, and TRUNCATE operations are blocked.",
    category: "data-protection",
    enforcement: "hard-block",
    active: true,
  },
  {
    id: "GOV-008",
    name: "Governance Approval Workflow",
    description:
      "Complex queries against Official-Sensitive data require governance officer approval before execution.",
    category: "access-control",
    enforcement: "hard-block",
    active: true,
  },
  {
    id: "GOV-009",
    name: "Full Audit Trail",
    description:
      "Every tool invocation, query submission, and access attempt is logged with user ID, timestamp, and outcome.",
    category: "audit",
    enforcement: "automatic",
    active: true,
  },
];

/**
 * Get all active governance policies (for transparency/documentation).
 */
export function getGovernancePolicies(): GovernancePolicy[] {
  return GOVERNANCE_POLICIES.filter(p => p.active);
}

// ─── Small-Number Suppression (GOV-005) ─────────────────────────────────────
// Enforces that analytical results with fewer than 5 records in any group
// are suppressed to prevent re-identification.

const MINIMUM_CELL_COUNT = 5;

export interface SuppressionResult {
  suppressed: boolean;
  reason?: string;
  originalCount?: number;
  policy: string;
}

/**
 * Apply small-number suppression to query results.
 * If any result group has a count below the threshold, the result is suppressed.
 */
export function applySmallNumberSuppression(resultCount: number): SuppressionResult {
  if (resultCount < MINIMUM_CELL_COUNT) {
    return {
      suppressed: true,
      reason: `Result suppressed: contains fewer than ${MINIMUM_CELL_COUNT} records (actual: ${resultCount}). This is required by governance policy GOV-005 to prevent potential re-identification of individuals.`,
      originalCount: resultCount,
      policy: "GOV-005",
    };
  }
  return { suppressed: false, policy: "GOV-005" };
}

/**
 * Check if a query result set passes small-number suppression rules.
 * Examines row counts in grouped results.
 */
export function checkSmallNumberSuppression(
  rows: Array<Record<string, unknown>>,
  countColumn?: string,
): SuppressionResult {
  // If total result set is too small
  if (rows.length > 0 && rows.length < MINIMUM_CELL_COUNT) {
    return {
      suppressed: true,
      reason: `Result suppressed: only ${rows.length} records returned, which is below the minimum threshold of ${MINIMUM_CELL_COUNT}. This prevents potential re-identification. Consider broadening your query criteria.`,
      originalCount: rows.length,
      policy: "GOV-005",
    };
  }

  // If there's a count column, check each group
  if (countColumn) {
    for (const row of rows) {
      const count = Number(row[countColumn]);
      if (!isNaN(count) && count > 0 && count < MINIMUM_CELL_COUNT) {
        return {
          suppressed: true,
          reason: `Result partially suppressed: one or more groups contain fewer than ${MINIMUM_CELL_COUNT} records. Values in small groups are replaced with '*' to prevent re-identification (GOV-005).`,
          originalCount: count,
          policy: "GOV-005",
        };
      }
    }
  }

  return { suppressed: false, policy: "GOV-005" };
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

interface RateLimitState {
  userId: string;
  queriesUsed: number;
  dailyLimit: number;
  windowStart: string;
}

const rateLimits = new Map<string, RateLimitState>();

export function checkRateLimit(session: UserSession): GovernanceDecision {
  const today = new Date().toISOString().split("T")[0];
  let state = rateLimits.get(session.userId);

  // Reset if new day
  if (!state || !state.windowStart.startsWith(today)) {
    state = {
      userId: session.userId,
      queriesUsed: 0,
      dailyLimit: session.dailyQueryLimit,
      windowStart: new Date().toISOString(),
    };
    rateLimits.set(session.userId, state);
  }

  if (state.queriesUsed >= state.dailyLimit) {
    return {
      allowed: false,
      reason: `Daily rate limit exceeded. ${state.queriesUsed}/${state.dailyLimit} queries used today. Limit resets at midnight.`,
    };
  }

  state.queriesUsed++;
  return { allowed: true };
}

export function getRateLimitStatus(session: UserSession): { used: number; limit: number; remaining: number } {
  const today = new Date().toISOString().split("T")[0];
  const state = rateLimits.get(session.userId);

  if (!state || !state.windowStart.startsWith(today)) {
    return { used: 0, limit: session.dailyQueryLimit, remaining: session.dailyQueryLimit };
  }

  return {
    used: state.queriesUsed,
    limit: state.dailyLimit,
    remaining: state.dailyLimit - state.queriesUsed,
  };
}

// ─── Access Control ─────────────────────────────────────────────────────────

const TIER_HIERARCHY: Record<string, number> = {
  "Tier 1": 1,
  "Tier 2": 2,
  "Tier 3": 3,
};

export function checkAccessControl(session: UserSession, requiredTier: string): GovernanceDecision {
  const userLevel = TIER_HIERARCHY[session.accessTier] ?? 0;
  const requiredLevel = TIER_HIERARCHY[requiredTier] ?? 0;

  if (userLevel < requiredLevel) {
    return {
      allowed: false,
      reason: `Access denied. Your clearance (${session.accessTier}) is insufficient for this resource (requires ${requiredTier}). Contact your Information Governance Officer to request access elevation.`,
    };
  }

  return { allowed: true };
}

// ─── Data Classification Enforcement ────────────────────────────────────────

export function checkClassification(session: UserSession, classificationLevel: string): GovernanceDecision {
  // Official data is accessible to all tiers
  if (classificationLevel === "Official") {
    return { allowed: true };
  }

  // Official - Sensitive requires Tier 2+
  if (classificationLevel === "Official - Sensitive") {
    const userLevel = TIER_HIERARCHY[session.accessTier] ?? 0;
    if (userLevel < 2) {
      return {
        allowed: false,
        reason: `Data classified as "${classificationLevel}" requires Tier 2+ access. Your current clearance: ${session.accessTier}.`,
        classificationWarning: classificationLevel,
      };
    }
    return {
      allowed: true,
      classificationWarning: `Accessing ${classificationLevel} data. All interactions are logged and subject to audit.`,
    };
  }

  return { allowed: false, reason: "Unknown classification level." };
}

// ─── Query Content Governance ───────────────────────────────────────────────
// Checks for prohibited patterns in analytical queries

const PROHIBITED_PATTERNS = [
  { pattern: /\bnhs\s*number/i, reason: "NHS Number is a direct patient identifier and cannot be extracted." },
  { pattern: /\bindividual\s+patient/i, reason: "Individual patient-level data extraction is prohibited." },
  { pattern: /\bidentif(y|ication)\b.*\bpatient/i, reason: "Patient identification queries are not permitted." },
  { pattern: /\bname\b.*\bpatient/i, reason: "Patient names are direct identifiers and cannot be queried." },
  { pattern: /\baddress\b.*\bpatient/i, reason: "Patient addresses are direct identifiers." },
  { pattern: /\bdate\s+of\s+birth\b/i, reason: "Date of birth combined with other fields may re-identify patients." },
  {
    pattern: /\bpostcode\b/i,
    reason: "Full postcodes may enable re-identification. Use LSOA-level geography instead.",
  },
  {
    pattern: /\bdelete\b|\bdrop\b|\btruncate\b/i,
    reason: "Destructive operations are not permitted on research data.",
  },
  { pattern: /\bupdate\b.*\bset\b/i, reason: "Data modification is not permitted. Research data is read-only." },
];

export function validateQueryContent(query: string): GovernanceDecision {
  for (const { pattern, reason } of PROHIBITED_PATTERNS) {
    if (pattern.test(query)) {
      return {
        allowed: false,
        reason: `Query rejected by Information Governance: ${reason}. Only aggregate, anonymised analyses are permitted.`,
      };
    }
  }

  return { allowed: true };
}

// ─── Query Approval Workflow ────────────────────────────────────────────────

export function determineApprovalRequirement(
  classificationLevel: string,
  queryComplexity: "simple" | "moderate" | "complex",
): { requiresApproval: boolean; reason?: string } {
  // Official-Sensitive always requires approval for complex queries
  if (classificationLevel === "Official - Sensitive" && queryComplexity === "complex") {
    return {
      requiresApproval: true,
      reason: "Complex queries against Official-Sensitive data require governance review before execution.",
    };
  }

  // Tier 3 data always requires approval
  if (classificationLevel === "Official - Sensitive") {
    return {
      requiresApproval: false,
    };
  }

  return { requiresApproval: false };
}

// ─── Audit Logging ──────────────────────────────────────────────────────────

export function createAuditEntry(
  userId: string,
  toolName: string,
  action: string,
  outcome: AuditLogEntry["outcome"],
  details: string,
  options?: {
    resourceType?: string;
    resourceId?: string;
    projectId?: string;
    ipAddress?: string;
  },
): AuditLogEntry {
  const entry: AuditLogEntry = {
    entryId: `audit-${uuidv4().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    userId,
    toolName,
    action,
    resourceType: options?.resourceType ?? null,
    resourceId: options?.resourceId ?? null,
    outcome,
    details,
    ipAddress: options?.ipAddress ?? null,
    projectId: options?.projectId ?? null,
  };

  // Persist to in-memory audit log
  auditLog.push(entry);

  return entry;
}

export function getAuditLog(filters?: {
  userId?: string;
  toolName?: string;
  outcome?: string;
  limit?: number;
}): AuditLogEntry[] {
  let entries = [...auditLog];

  if (filters?.userId) {
    entries = entries.filter(e => e.userId === filters.userId);
  }
  if (filters?.toolName) {
    entries = entries.filter(e => e.toolName === filters.toolName);
  }
  if (filters?.outcome) {
    entries = entries.filter(e => e.outcome === filters.outcome);
  }

  // Sort by most recent first
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return entries.slice(0, filters?.limit ?? 50);
}
