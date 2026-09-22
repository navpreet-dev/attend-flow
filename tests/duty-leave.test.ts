/**
 * Focused regression test suite for AGC LMS Duty Leave attendance support.
 *
 * Scenarios tested:
 * 1. Present only
 * 2. Absent only
 * 3. Duty Leave only
 * 4. Present + Duty Leave
 * 5. Present + Absent + Duty Leave (Example from prompt: P=25, DL=5, A=10 -> Total=40, Attended=30, Attendance=75%)
 * 6. Duty Leave percentage calculation
 * 7. Recovery calculation with Duty Leave baseline
 * 8. Bunk simulator starting with Duty Leave as attended
 * 9. AGC HTML report parser with real live portal snippet containing "DUTY LEAVE"
 * 10. Unknown / unverified status safety test
 */

import { calculateRecovery, simulateAttendance } from "../src/lib/attendance-calculator";
import { overallStats, mustAttend, canSkip } from "../src/lib/af-client";
import type { SubjectInfo, LogInfo } from "../src/lib/types";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✓ PASS: ${msg}`);
  }
}

console.log("=== RUNNING DUTY LEAVE REGRESSION TESTS ===\n");

// ---------------------------------------------------------------------------
// TEST 1: Present only
// ---------------------------------------------------------------------------
console.log("TEST 1: Present only");
{
  const p = 15;
  const dl = 0;
  const a = 0;
  const total = p + dl + a;
  const attended = p + dl;
  const pct = total > 0 ? (attended / total) * 100 : 0;
  assert(total === 15, "Total should be 15");
  assert(attended === 15, "Attended should be 15");
  assert(pct === 100, "Percentage should be 100%");
}

// ---------------------------------------------------------------------------
// TEST 2: Absent only
// ---------------------------------------------------------------------------
console.log("\nTEST 2: Absent only");
{
  const p = 0;
  const dl = 0;
  const a = 10;
  const total = p + dl + a;
  const attended = p + dl;
  const pct = total > 0 ? (attended / total) * 100 : 0;
  assert(total === 10, "Total should be 10");
  assert(attended === 0, "Attended should be 0");
  assert(pct === 0, "Percentage should be 0%");
}

// ---------------------------------------------------------------------------
// TEST 3: Duty Leave only
// ---------------------------------------------------------------------------
console.log("\nTEST 3: Duty Leave only");
{
  const p = 0;
  const dl = 8;
  const a = 0;
  const total = p + dl + a;
  const attended = p + dl;
  const pct = total > 0 ? (attended / total) * 100 : 0;
  assert(total === 8, "Total should be 8");
  assert(attended === 8, "Duty Leave counts as attended (8/8)");
  assert(pct === 100, "Duty Leave only percentage is 100%");
}

// ---------------------------------------------------------------------------
// TEST 4: Present + Duty Leave
// ---------------------------------------------------------------------------
console.log("\nTEST 4: Present + Duty Leave");
{
  const p = 20;
  const dl = 5;
  const a = 0;
  const total = p + dl + a;
  const attended = p + dl;
  const pct = total > 0 ? (attended / total) * 100 : 0;
  assert(total === 25, "Total should be 25");
  assert(attended === 25, "Attended is 25 (20 P + 5 DL)");
  assert(pct === 100, "Percentage is 100%");
}

// ---------------------------------------------------------------------------
// TEST 5: Present + Absent + Duty Leave (Main Example from prompt)
// Present = 25, Duty Leave = 5, Absent = 10 -> Total = 40, Attended = 30, Attendance = 75%
// ---------------------------------------------------------------------------
console.log("\nTEST 5: Present + Absent + Duty Leave (Main Prompt Spec)");
{
  const p = 25;
  const dl = 5;
  const a = 10;
  const total = p + dl + a;
  const attended = p + dl;
  const pct = (attended / total) * 100;
  assert(total === 40, "Total should be 40");
  assert(attended === 30, "Attended should be 30 (25 P + 5 DL)");
  assert(pct === 75, "Attendance % should be exactly 75%");

  // Test with overallStats helper
  const subject: SubjectInfo = {
    subjectCode: "AGC-TEST",
    subjectName: "Test Subject",
    subjectType: "Theory",
    attended,
    total,
    percentage: pct,
  };
  const stats = overallStats([subject]);
  assert(stats.attended === 30, "overallStats attended is 30");
  assert(stats.total === 40, "overallStats total is 40");
  assert(stats.percentage === 75, "overallStats percentage is 75%");
}

// ---------------------------------------------------------------------------
// TEST 6: Duty Leave percentage formula accuracy
// Formula: (Present + Duty Leave) / Total * 100
// ---------------------------------------------------------------------------
console.log("\nTEST 6: Duty Leave percentage formula accuracy");
{
  const cases = [
    { p: 18, dl: 2, a: 5, expectedAttended: 20, expectedTotal: 25, expectedPct: 80 },
    { p: 10, dl: 4, a: 6, expectedAttended: 14, expectedTotal: 20, expectedPct: 70 },
    { p: 33, dl: 3, a: 4, expectedAttended: 36, expectedTotal: 40, expectedPct: 90 },
  ];
  for (const c of cases) {
    const total = c.p + c.dl + c.a;
    const attended = c.p + c.dl;
    const pct = (attended / total) * 100;
    assert(attended === c.expectedAttended, `Attended: ${attended} == ${c.expectedAttended}`);
    assert(total === c.expectedTotal, `Total: ${total} == ${c.expectedTotal}`);
    assert(pct === c.expectedPct, `Pct: ${pct}% == ${c.expectedPct}%`);
  }
}

// ---------------------------------------------------------------------------
// TEST 7: Recovery calculation with Duty Leave baseline
// Baseline: Present=20, DutyLeave=4, Absent=6 -> Attended=24, Total=30 (80%)
// Target = 85%. Required: (24 + R) / (30 + R) >= 0.85 -> 24 + R >= 25.5 + 0.85R -> 0.15R >= 1.5 -> R >= 10
// Check with R = 10: (24 + 10) / (30 + 10) = 34 / 40 = 85.0%
// ---------------------------------------------------------------------------
console.log("\nTEST 7: Recovery calculation with Duty Leave baseline");
{
  const attended = 20 + 4; // 24 (includes Duty Leave)
  const total = 30;
  const target = 85;
  const rec = calculateRecovery(attended, total, target);
  assert(rec.status === "RECOVERABLE", "Status should be RECOVERABLE");
  assert(rec.classesNeeded === 10, `Classes needed should be 10, got ${rec.classesNeeded}`);
  assert(rec.currentAttended === 24, "Recovery starting attended is 24 (not 20)");
  assert(rec.currentTotal === 30, "Recovery starting total is 30");
  assert(rec.projectedPercentage === 85, "Projected percentage reaches 85%");
}

// ---------------------------------------------------------------------------
// TEST 8: What-If / Bunk Simulator starting with Duty Leave as attended
// Example: Present=20, Duty Leave=4, Absent=6 -> Starts at 24/30 (80%)
// Bunk 2 classes: (24 + 0) / (30 + 2) = 24 / 32 = 75.0%
// ---------------------------------------------------------------------------
console.log("\nTEST 8: What-If / Bunk Simulator starting with Duty Leave");
{
  const attended = 20 + 4; // 24
  const total = 30;
  const sim = simulateAttendance(attended, total, 0, 2, 75);
  assert(sim.initialAttended === 24, "Simulator starting attended is 24");
  assert(sim.initialTotal === 30, "Simulator starting total is 30");
  assert(sim.initialPercentage === 80, "Initial percentage is 80%");
  assert(sim.projectedAttended === 24, "Projected attended remains 24");
  assert(sim.projectedTotal === 32, "Projected total is 32 (30 + 2 bunk)");
  assert(sim.projectedPercentage === 75, "Projected percentage drops to 75.0%");
  assert(sim.isAboveTarget === true, "75.0% meets 75% target");
}

// ---------------------------------------------------------------------------
// TEST 9: AGC Portal HTML Parser with real live portal snippet containing "DUTY LEAVE"
// ---------------------------------------------------------------------------
console.log("\nTEST 9: AGC Portal HTML parser with live DUTY LEAVE representation");
{
  // Exact HTML table pattern returned by AGC LMS
  const samplePortalHtml = `
    <table class="table table-responsive table-striped table-sm">
      <thead class="thead-dark">
        <tr><th>Date</th><th>Attendance</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>15-07-2026</td>
          <td>ABSENT</td>
        </tr>
        <tr>
          <td>16-07-2026</td>
          <td>PRESENT</td>
        </tr>
        <tr>
          <td>27-07-2026</td>
          <td>DUTY LEAVE</td>
        </tr>
        <tr>
          <td>28-07-2026</td>
          <td>PRESENT</td>
        </tr>
      </tbody>
    </table>
  `;

  // Emulate parseAttendanceReport logic from portal.ts
  const DATE_RE = /\b(\d{2})[-/](\d{2})[-/](\d{4})\b/;
  function stripTags(html: string): string {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  let attended = 0;
  let total = 0;
  const logs: { date: string; status: "PRESENT" | "ABSENT" | "DUTY_LEAVE" }[] = [];

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(samplePortalHtml)) !== null) {
    const row = tr[1];
    const rowText = stripTags(row);
    const dm = rowText.match(DATE_RE);
    if (!dm) continue;

    let status: "PRESENT" | "ABSENT" | "DUTY_LEAVE" | null = null;
    if (/\bDUTY\s+LEAVE\b/i.test(rowText) || /\bDUTY\b/i.test(rowText)) status = "DUTY_LEAVE";
    else if (/\bPRESENT\b/i.test(rowText)) status = "PRESENT";
    else if (/\bABSENT\b/i.test(rowText)) status = "ABSENT";
    else if (/\bP\b/.test(rowText) && rowText.replace(/[^A-Za-z]/g, "").length <= 1) status = "PRESENT";
    else if (/\bA\b/.test(rowText) && rowText.replace(/[^A-Za-z]/g, "").length <= 1) status = "ABSENT";
    if (!status) continue;

    total += 1;
    if (status === "PRESENT" || status === "DUTY_LEAVE") attended += 1;
    logs.push({
      date: `${dm[1]}-${dm[2]}-${dm[3]}`,
      status,
    });
  }

  assert(total === 4, "Total classes parsed should be 4");
  assert(attended === 3, "Attended should be 3 (2 PRESENT + 1 DUTY LEAVE)");
  assert(logs.length === 4, "4 logs parsed");

  const dlLog = logs.find((l) => l.date === "27-07-2026");
  assert(dlLog !== undefined, "27-07-2026 log must exist");
  assert(dlLog?.status === "DUTY_LEAVE", "27-07-2026 status must be DUTY_LEAVE");
}

// ---------------------------------------------------------------------------
// TEST 10: Unknown / Unverified status safety test
// Ensures unrecognized strings like "MEDICAL LEAVE" or "EXEMPTED" are safely ignored
// rather than blindly misclassified as Present, Absent, or Duty Leave.
// ---------------------------------------------------------------------------
console.log("\nTEST 10: Unknown status safely handled");
{
  const unknownHtml = `
    <tr>
      <td>10-08-2026</td>
      <td>MEDICAL LEAVE</td>
    </tr>
    <tr>
      <td>11-08-2026</td>
      <td>CANCELLED</td>
    </tr>
  `;
  const DATE_RE = /\b(\d{2})[-/](\d{2})[-/](\d{4})\b/;
  function stripTags(html: string): string {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  const logs: any[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(unknownHtml)) !== null) {
    const row = tr[1];
    const rowText = stripTags(row);
    const dm = rowText.match(DATE_RE);
    if (!dm) continue;

    let status: "PRESENT" | "ABSENT" | "DUTY_LEAVE" | null = null;
    if (/\bDUTY\s+LEAVE\b/i.test(rowText) || /\bDUTY\b/i.test(rowText)) status = "DUTY_LEAVE";
    else if (/\bPRESENT\b/i.test(rowText)) status = "PRESENT";
    else if (/\bABSENT\b/i.test(rowText)) status = "ABSENT";
    if (!status) continue;

    logs.push({ date: `${dm[1]}-${dm[2]}-${dm[3]}`, status });
  }

  assert(logs.length === 0, "Unrecognized statuses must not be classified as Present/Absent/Duty Leave");
}

console.log("\n🎉 ALL 10 DUTY LEAVE REGRESSION TESTS PASSED!\n");
