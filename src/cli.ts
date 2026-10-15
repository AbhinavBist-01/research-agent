import "dotenv/config";
import { ToolRegistry } from "./tools/registry.js";
import { createSearchWebTool } from "./tools/search-web.js";
import { createFetchPageTool } from "./tools/fetch-page.js";
import { createRecordEvidenceTool } from "./tools/record-evidence.js";
import { EvidenceStore } from "./research/evidence-store.js";
import { SingleAgent } from "./research/single-agent.js";
import type { ResearchJob } from "./types.js";

async function main() {
  const topic = process.argv[2] || "Continuous batching in LLM inference and its trade-offs";
  console.log(`\n======================================================`);
  console.log(`🤖 STARTING PHASE 1 RESEARCH RUN`);
  console.log(`Topic: "${topic}"`);
  console.log(`======================================================\n`);

  // 1. Initialize Evidence Store & Tool Registry
  const store = new EvidenceStore();
  const tools = new ToolRegistry();

  tools.register(createSearchWebTool());
  tools.register(createFetchPageTool());
  tools.register(createRecordEvidenceTool(store));

  console.log(`Registered Tools: ${tools.listNames().join(", ")}`);

  // 2. Create Job
  const job: ResearchJob = {
    id: `job_${Date.now()}`,
    topic,
    status: "researching",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    taskIds: ["task_1"],
  };

  // 3. Run Single Agent
  const agent = new SingleAgent({ maxIterations: 5 });
  const report = await agent.runResearch(job, tools, store);

  console.log(`\n======================================================`);
  console.log(`📄 FINAL RESEARCH REPORT`);
  console.log(`======================================================\n`);
  console.log(report.markdown);

  console.log(`\n------------------------------------------------------`);
  console.log(`STATISTICS:`);
  console.log(`- Total Sources: ${report.sources.length}`);
  console.log(`- Extracted Evidence Items: ${report.evidence.length}`);
  console.log(`- Grounded Claims: ${report.claims.length}`);
  console.log(`------------------------------------------------------\n`);
}

main().catch((err) => {
  console.error("Fatal error during research execution:", err);
  process.exit(1);
});
