import {
  pgTable,
  varchar,
  text,
  timestamp,
  integer,
  numeric,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// 1. Research Jobs
export const researchJobs = pgTable("research_jobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  topic: text("topic").notNull(),
  scope: text("scope").array(),
  status: varchar("status", { length: 32 }).notNull().default("queued"),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 2. Research Tasks
export const researchTasks = pgTable(
  "research_tasks",
  {
    id: varchar("id", { length: 64 }).notNull(),
    jobId: varchar("job_id", { length: 64 })
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    assignedAgent: varchar("assigned_agent", { length: 64 }).notNull(),
    dependsOn: text("depends_on").array(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.id] }),
  ]
);

// 3. Sources Registry
export const sources = pgTable("sources", {
  id: varchar("id", { length: 64 }).primaryKey(),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url").notNull().unique(),
  title: text("title").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  fetchStatus: varchar("fetch_status", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 4. Evidence Store (Idempotent per Job + Source + Excerpt)
export const evidence = pgTable(
  "evidence",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    jobId: varchar("job_id", { length: 64 })
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
    sourceId: varchar("source_id", { length: 64 })
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    claim: text("claim").notNull(),
    excerpt: text("excerpt").notNull(),
    extractionMethod: varchar("extraction_method", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_job_source_excerpt").on(table.jobId, table.sourceId, table.excerpt),
  ]
);

// 5. Agent Runs (Idempotent per Job + Task + Attempt)
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    jobId: varchar("job_id", { length: 64 })
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
    taskId: varchar("task_id", { length: 64 }).notNull(),
    agentName: varchar("agent_name", { length: 64 }).notNull(),
    attempt: integer("attempt").notNull(),
    modelName: varchar("model_name", { length: 64 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    durationMs: integer("duration_ms").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_task_attempt").on(table.jobId, table.taskId, table.attempt),
  ]
);

// 6. Research Reports
export const researchReports = pgTable("research_reports", {
  id: varchar("id", { length: 64 }).primaryKey(),
  jobId: varchar("job_id", { length: 64 })
    .notNull()
    .references(() => researchJobs.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  summary: text("summary").notNull(),
  markdown: text("markdown").notNull(),
  citationPrecision: numeric("citation_precision", { precision: 5, scale: 2 }).notNull(),
  totalSources: integer("total_sources").notNull(),
  totalEvidence: integer("total_evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Infer types from Drizzle schema
export type ResearchJobRow = typeof researchJobs.$inferSelect;
export type InsertResearchJob = typeof researchJobs.$inferInsert;

export type ResearchTaskRow = typeof researchTasks.$inferSelect;
export type InsertResearchTask = typeof researchTasks.$inferInsert;

export type SourceRow = typeof sources.$inferSelect;
export type InsertSource = typeof sources.$inferInsert;

export type EvidenceRow = typeof evidence.$inferSelect;
export type InsertEvidence = typeof evidence.$inferInsert;

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type InsertAgentRun = typeof agentRuns.$inferInsert;

export type ResearchReportRow = typeof researchReports.$inferSelect;
export type InsertResearchReport = typeof researchReports.$inferInsert;
