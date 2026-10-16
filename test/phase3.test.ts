import { SourceRegistry } from "../src/evidence/source-registry.js";
import { CitationVerifier } from "../src/evidence/citation-verifier.js";
import { ContradictionResolver } from "../src/evidence/contradiction-resolver.js";
import type { ReportClaim, Evidence } from "../src/types.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${msg}`);
  }
  console.log(`✅ ${msg}`);
}

async function runPhase3Tests() {
  console.log("\n🧪 RUNNING PHASE 3 EVIDENCE VERIFICATION TEST SUITE...\n");

  const registry = new SourceRegistry();

  // Register real source
  const s1 = registry.register({
    url: "https://arxiv.org/abs/2309.06180",
    title: "vLLM: Continuous Batching and PagedAttention",
    content: "Continuous batching schedules requests dynamically at each token step. Empirical evaluations on GPU clusters demonstrate 2x to 4x throughput improvements on workloads with variable sequence lengths.",
  });

  assert(s1.id.startsWith("src_"), "Registers source with clean unique ID");

  // -------------------------------------------------------------
  // Test 1: Level 3 Grounding Check (Verbatim vs Hallucinated Quote)
  // -------------------------------------------------------------
  console.log("\n--- 1. Testing Level 3 Text Grounding ---");
  const authenticQuote = "Continuous batching schedules requests dynamically at each token step.";
  const fakeQuote = "Continuous batching always achieves 100x speedup and eliminates all memory usage.";

  const groundPass = registry.verifyGrounding(s1.id, authenticQuote);
  assert(groundPass.grounded, "Validates authentic verbatim quote exists in source");

  const groundFail = registry.verifyGrounding(s1.id, fakeQuote);
  assert(!groundFail.grounded, "Detects and rejects fabricated quote not in source");

  // -------------------------------------------------------------
  // Test 2: Level 1 & 2 Integrity Checks (Phantom Evidence & Missing Sources)
  // -------------------------------------------------------------
  console.log("\n--- 2. Testing Level 1 & 2 Citation Integrity ---");
  const verifier = new CitationVerifier();

  const realEvidence: Evidence[] = [
    {
      id: "ev_real_1",
      sourceId: s1.id,
      sourceUrl: s1.url,
      sourceTitle: s1.title,
      claim: "Continuous batching schedules requests at the iteration level.",
      excerpt: authenticQuote,
      extractionMethod: "agent_extracted",
    },
  ];

  // Claim with non-existent evidence ID
  const phantomClaim: ReportClaim = {
    id: "claim_ghost",
    text: "Continuous batching is good.",
    evidenceIds: ["ev_ghost_999"], // phantom ID
    verificationStatus: "pending",
  };

  const auditGhost = await verifier.verifyReportClaims([phantomClaim], realEvidence, registry);
  assert(auditGhost.verifiedClaims[0]?.verificationStatus === "unsupported", "Level 1 flags claim with phantom citation as unsupported");
  assert(auditGhost.auditResults[0]?.issues.some((i) => i.includes("Level 1 Failure")), "Records explicit Level 1 issue");

  // -------------------------------------------------------------
  // Test 3: Level 4 Entailment & Exaggeration Detection
  // -------------------------------------------------------------
  console.log("\n--- 3. Testing Level 4 Entailment & Exaggeration Checks ---");
  const exaggeratedClaim: ReportClaim = {
    id: "claim_exaggerated",
    text: "Continuous batching universally guarantees 100% throughput boost on every hardware platform.",
    evidenceIds: ["ev_real_1"],
    verificationStatus: "pending",
  };

  const auditExaggeration = await verifier.verifyReportClaims([exaggeratedClaim], realEvidence, registry);
  assert(
    auditExaggeration.verifiedClaims[0]?.verificationStatus === "partially_supported" ||
      auditExaggeration.verifiedClaims[0]?.verificationStatus === "unsupported",
    "Level 4 flags exaggerated universal statement not substantiated by source"
  );

  // Valid, grounded claim
  const validClaim: ReportClaim = {
    id: "claim_valid",
    text: "Continuous batching dynamically schedules requests at token generation iterations.",
    evidenceIds: ["ev_real_1"],
    verificationStatus: "pending",
  };

  const auditValid = await verifier.verifyReportClaims([validClaim], realEvidence, registry);
  assert(auditValid.verifiedClaims[0]?.verificationStatus === "supported", "Level 4 marks well-grounded claim as supported");

  // -------------------------------------------------------------
  // Test 4: Level 5 Contradiction Resolution & Nuance Handling
  // -------------------------------------------------------------
  console.log("\n--- 4. Testing Level 5 Contradiction Resolution ---");
  const resolver = new ContradictionResolver();
  const opposingClaims: ReportClaim[] = [
    {
      id: "claim_throughput",
      text: "Continuous batching increases throughput substantially on concurrent workloads.",
      evidenceIds: ["ev_real_1"],
      verificationStatus: "supported",
    },
    {
      id: "claim_latency",
      text: "Continuous batching reduces throughput and causes higher latency under short fixed sequences.",
      evidenceIds: ["ev_real_1"],
      verificationStatus: "supported",
    },
  ];

  const evMap = new Map<string, Evidence>(realEvidence.map((e) => [e.id, e]));
  const contradictionRes = await resolver.resolveContradictions(opposingClaims, evMap);

  assert(contradictionRes.detectedContradictions.length > 0, "Detects contrasting claims between throughput and latency under short sequences");
  assert(
    contradictionRes.detectedContradictions[0]?.resolution.length! > 0,
    "Provides context and conditional resolution rather than forcing arbitrary consensus"
  );

  console.log("\n🎉 ALL PHASE 3 EVIDENCE VERIFICATION TESTS PASSED SUCCESSFULLY!\n");
}

runPhase3Tests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
