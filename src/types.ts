export type JobStatus =
  | "queued"
  | "planning"
  | "researching"
  | "synthesizing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface ResearchJob {
  id: string;
  topic: string;
  scope?: string[] | undefined;
  status: JobStatus;
  createdAt: string;
  deadlineAt: string;
  taskIds: string[];
}

export interface ResearchTask {
  id: string;
  jobId: string;
  question: string;
  assignedAgent: string;
  dependsOn?: string[];
  status: TaskStatus;
  resultIds: string[];
}

export interface Source {
  id: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  retrievedAt: string;
  contentHash: string;
  content: string;
  fetchStatus: "success" | "failed" | "blocked";
  error?: string;
}

export interface Evidence {
  id: string;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string;
  claim: string;
  excerpt: string;
  location?: {
    section?: string;
    page?: number;
  };
  extractionMethod: "agent_extracted" | "direct_quote" | "automated";
  relevantToTaskIds?: string[];
}

export interface ReportClaim {
  id: string;
  text: string;
  evidenceIds: string[];
  verificationStatus:
    | "pending"
    | "supported"
    | "partially_supported"
    | "unsupported"
    | "conflicting";
  limitations?: string[];
}

export interface ResearchReport {
  jobId: string;
  topic: string;
  summary: string;
  claims: ReportClaim[];
  evidence: Evidence[];
  sources: Source[];
  markdown: string;
  createdAt: string;
}

export interface ToolContext {
  jobId?: string;
  taskId?: string;
  deadlineAt?: string;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  schema: import("zod").ZodType<TInput>;
  execute(input: TInput, context?: ToolContext): Promise<TOutput>;
}
