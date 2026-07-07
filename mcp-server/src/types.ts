// ─── NHS Research Platform - Type Definitions ───────────────────────────────

export interface ResearchProject {
  projectId: string;
  title: string;
  description: string;
  principalInvestigator: string;
  status: "Active" | "Completed" | "Suspended";
  approvalDate: string;
  expiryDate: string;
  ethicsReference: string;
  fundingBody: string;
  researchDomain: string;
  accessTier: "Tier 1" | "Tier 2" | "Tier 3";
}

export interface ResearchDataset {
  datasetId: string;
  name: string;
  description: string;
  classificationLevel: "Official" | "Official - Sensitive";
  dataOwner: string;
  recordCount: number;
  lastUpdated: string;
  dataCategory: string;
  isSynthetic: boolean;
  retentionPolicy: string;
  projectId: string;
}

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

export interface AuditLogEntry {
  entryId: string;
  timestamp: string;
  userId: string;
  toolName: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: "Success" | "Rejected" | "Pending" | "Rate Limited";
  details: string;
  ipAddress: string | null;
  projectId: string | null;
}

export interface UserSession {
  userId: string;
  username: string;
  displayName: string;
  role:
    | "Senior Researcher"
    | "Researcher"
    | "Data Scientist"
    | "Clinical Research Fellow"
    | "Platform Administrator"
    | "Analyst"
    | "Governance Officer";
  accessTier: "Tier 1" | "Tier 2" | "Tier 3";
  dailyQueryLimit: number;
  queriesUsedToday: number;
  sessionStart: string;
  /** Projects this user has access to (["*"] means all) */
  projects: string[];
}

export interface GovernanceDecision {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  classificationWarning?: string;
}
