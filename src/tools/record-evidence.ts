import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import type { EvidenceStore } from "../research/evidence-store.js";

const RecordEvidenceSchema = z.object({
  sourceUrl: z.string().url().describe("The URL of the source where the evidence was found"),
  sourceTitle: z.string().describe("The title or publication name of the source"),
  claim: z.string().describe("A concise factual finding or takeaway from the source"),
  excerpt: z.string().describe("The exact verbatim quote or passage from the source supporting the claim"),
});

export function createRecordEvidenceTool(store: EvidenceStore): ToolDefinition<z.infer<typeof RecordEvidenceSchema>, { evidenceId: string; sourceId: string; status: string }> {
  return {
    name: "record_evidence",
    description: "Record a verified factual claim and its exact supporting excerpt from a retrieved source URL into the evidence store.",
    schema: RecordEvidenceSchema,
    async execute(input) {
      // Find or create source
      const source = store.addSource({
        url: input.sourceUrl,
        title: input.sourceTitle,
        retrievedAt: new Date().toISOString(),
        contentHash: "",
        content: input.excerpt,
        fetchStatus: "success",
      });

      // Add evidence item
      const evidence = store.addEvidence({
        sourceId: source.id,
        sourceUrl: source.url,
        sourceTitle: source.title,
        claim: input.claim,
        excerpt: input.excerpt,
        extractionMethod: "agent_extracted",
      });

      return {
        evidenceId: evidence.id,
        sourceId: source.id,
        status: "recorded",
      };
    },
  };
}
