import { isSafeUrl, cleanHtml } from "../src/tools/fetch-page.js";
import { EvidenceStore } from "../src/research/evidence-store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSearchWebTool } from "../src/tools/search-web.js";
import { createFetchPageTool } from "../src/tools/fetch-page.js";
import { createRecordEvidenceTool } from "../src/tools/record-evidence.js";
import { SingleAgent } from "../src/research/single-agent.js";
import type { ResearchJob } from "../src/types.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${msg}`);
  }
  console.log(`✅ ${msg}`);
}

async function runTests() {
  console.log("\n🧪 RUNNING PHASE 1 TEST SUITE...\n");

  // 1. Test SSRF Protection
  console.log("--- 1. Testing SSRF & URL Validation ---");
  assert(!isSafeUrl("http://localhost:3000").safe, "Rejects localhost");
  assert(!isSafeUrl("http://127.0.0.1:8000").safe, "Rejects 127.0.0.1");
  assert(!isSafeUrl("http://169.254.169.254/latest/meta-data").safe, "Rejects AWS/cloud metadata IP");
  assert(!isSafeUrl("http://10.0.0.1/admin").safe, "Rejects private IP (10.x.x.x)");
  assert(!isSafeUrl("http://192.168.1.1").safe, "Rejects private IP (192.168.x.x)");
  assert(isSafeUrl("https://arxiv.org/abs/2309.06180").safe, "Accepts public HTTPS URL");

  // 2. Test HTML Sanitization
  console.log("\n--- 2. Testing HTML Sanitization ---");
  const rawHtml = `<html><head><script>alert('pwned')</script><style>body { color: red; }</style></head>
    <body>
      <nav><a href="/home">Home</a></nav>
      <h1>Continuous Batching</h1>
      <p>Continuous batching reduces GPU idle time significantly.</p>
      <footer>Copyright 2026</footer>
    </body></html>`;
  const cleaned = cleanHtml(rawHtml);
  assert(!cleaned.includes("alert"), "Strips script tags");
  assert(!cleaned.includes("color: red"), "Strips style tags");
  assert(!cleaned.includes("Home"), "Strips nav tags");
  assert(!cleaned.includes("Copyright"), "Strips footer tags");
  assert(cleaned.includes("Continuous Batching"), "Preserves heading text");
  assert(cleaned.includes("reduces GPU idle time"), "Preserves body text");

  // 3. Test Evidence Store & Deduplication
  console.log("\n--- 3. Testing Evidence Store & Deduplication ---");
  const store = new EvidenceStore();
  const s1 = store.addSource({
    url: "https://example.com/vllm",
    title: "vLLM Documentation",
    retrievedAt: new Date().toISOString(),
    contentHash: "hash123",
    content: "Sample content",
    fetchStatus: "success",
  });
  const s2 = store.addSource({
    url: "https://example.com/vllm",
    title: "Duplicate Documentation",
    retrievedAt: new Date().toISOString(),
    contentHash: "hash123",
    content: "Sample content",
    fetchStatus: "success",
  });
  assert(s1.id === s2.id, "Deduplicates source with same URL/hash");
  assert(store.getAllSources().length === 1, "Stores exactly 1 unique source");

  const ev1 = store.addEvidence({
    sourceId: s1.id,
    sourceUrl: s1.url,
    sourceTitle: s1.title,
    claim: "Continuous batching improves throughput.",
    excerpt: "Benchmarks demonstrate substantial throughput improvements.",
    extractionMethod: "agent_extracted",
  });
  assert(ev1.id === "ev_1", "Generates stable sequential evidence ID");
  assert(store.getAllEvidence().length === 1, "Records evidence accurately");

  // 4. Test Single Agent End-to-End
  console.log("\n--- 4. Testing Single Agent End-to-End ---");
  const tools = new ToolRegistry();
  tools.register(createSearchWebTool());
  tools.register(createFetchPageTool());
  tools.register(createRecordEvidenceTool(store));

  const job: ResearchJob = {
    id: "job_test_1",
    topic: "Continuous batching vs static batching",
    status: "researching",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    taskIds: ["task_1"],
  };

  const agent = new SingleAgent({ maxIterations: 3 });
  const report = await agent.runResearch(job, tools, store);

  assert(report.claims.length > 0, "Report contains factual claims");
  assert(report.markdown.includes("# Research Report"), "Report markdown renders title");
  assert(report.markdown.includes("## Sources & Citation Registry"), "Report markdown renders bibliography");
  assert(report.claims.every((c) => c.evidenceIds.length > 0), "Every claim is grounded in at least 1 evidence ID");

  console.log("\n🎉 ALL PHASE 1 TESTS PASSED SUCCESSFULLY!\n");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
