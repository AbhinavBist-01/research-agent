import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ToolRegistry } from "./tools/registry.js";
import { createSearchWebTool } from "./tools/search-web.js";
import { createFetchPageTool } from "./tools/fetch-page.js";
import { createRecordEvidenceTool } from "./tools/record-evidence.js";
import { EvidenceStore } from "./research/evidence-store.js";
import { SingleAgent } from "./research/single-agent.js";
import type { ResearchJob, ResearchReport } from "./types.js";

async function runResearchTopic(
  topic: string,
  modelName: string
): Promise<ResearchReport> {
  console.log(`\n======================================================`);
  console.log(`🤖 STARTING RESEARCH`);
  console.log(`Topic: "${topic}"`);
  console.log(`Model: ${modelName}`);
  console.log(`======================================================\n`);

  const store = new EvidenceStore();
  const tools = new ToolRegistry();

  tools.register(createSearchWebTool());
  tools.register(createFetchPageTool());
  tools.register(createRecordEvidenceTool(store));

  const job: ResearchJob = {
    id: `job_${Date.now()}`,
    topic,
    status: "researching",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 120000).toISOString(),
    taskIds: ["task_1"],
  };

  const agent = new SingleAgent({ maxIterations: 5, modelName });
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

  return report;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  let currentModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
  let lastReport: ResearchReport | null = null;

  console.log(`\n======================================================`);
  console.log(`       🔍 INTERACTIVE AI RESEARCH AGENT (PHASE 1)      `);
  console.log(`======================================================`);
  console.log(`Commands:`);
  console.log(` • Type any research question to start researching.`);
  console.log(` • 'model <name>' to switch models (currently: ${currentModel})`);
  console.log(` • 'save [filename]' to export last report to markdown`);
  console.log(` • 'exit' or 'quit' to close.\n`);

  // If a topic was passed as a CLI argument, run it first
  const initialArg = process.argv.slice(2).join(" ").trim();
  if (initialArg) {
    try {
      lastReport = await runResearchTopic(initialArg, currentModel);
    } catch (err: any) {
      console.error("\n❌ Error during research:", err?.message || err);
    }
  }

  while (true) {
    const rawInput = await rl.question("\n🔬 Enter research question > ");
    const trimmed = rawInput.trim();

    if (!trimmed) continue;

    // Handle commands
    if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "q") {
      console.log("\n👋 Goodbye!\n");
      rl.close();
      process.exit(0);
    }

    if (trimmed.toLowerCase() === "help") {
      console.log(`\nCommands:`);
      console.log(` • Just type your question (e.g. "How does speculative decoding work?")`);
      console.log(` • 'model <name>' (e.g. 'model gpt-4o')`);
      console.log(` • 'save [filename.md]' to save the last report`);
      console.log(` • 'exit' or 'quit' to exit`);
      continue;
    }

    if (trimmed.toLowerCase().startsWith("model ")) {
      const newModel = trimmed.slice(6).trim();
      if (newModel) {
        currentModel = newModel;
        console.log(`✅ Active model changed to: ${currentModel}`);
      }
      continue;
    }

    if (trimmed.toLowerCase().startsWith("save")) {
      if (!lastReport) {
        console.log("⚠️ No report has been generated yet to save.");
        continue;
      }
      const parts = trimmed.split(/\s+/);
      const filename = parts[1] || `report-${Date.now()}.md`;
      const filePath = path.resolve(process.cwd(), filename);
      await fs.writeFile(filePath, lastReport.markdown, "utf8");
      console.log(`💾 Report successfully saved to: ${filePath}`);
      continue;
    }

    // Execute research query
    try {
      lastReport = await runResearchTopic(trimmed, currentModel);
      console.log(`💡 Tip: type 'save' to export this report to a markdown file.`);
    } catch (err: any) {
      console.error("\n❌ Error during research:", err?.message || err);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
