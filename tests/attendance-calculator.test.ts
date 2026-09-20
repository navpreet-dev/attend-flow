import { calculateRecovery, simulateAttendance } from "../src/lib/attendance-calculator";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✓ PASS: ${msg}`);
  }
}

console.log("--- RUNNING ATTENDANCE CALCULATOR TESTS ---\n");

// Test 1: User Example from prompt: 23 / 28 = 82.14%, target 75% -> already above
{
  const res = calculateRecovery(23, 28, 75);
  assert(res.status === "ALREADY_ABOVE", "23/28 with 75% target is ALREADY_ABOVE");
  assert(res.classesNeeded === 0, "classesNeeded is 0 when already above");
}

// Test 2: Below target recovery: 20 / 30 = 66.67%, target 75%
// Equation: (20 + R)/(30 + R) >= 0.75 -> 20 + R >= 22.5 + 0.75R -> 0.25R >= 2.5 -> R >= 10
// Check with R = 10: (20 + 10) / (30 + 10) = 30 / 40 = 75.0%
{
  const res = calculateRecovery(20, 30, 75);
  assert(res.status === "RECOVERABLE", "20/30 with 75% target is RECOVERABLE");
  assert(res.classesNeeded === 10, `classesNeeded should be 10, got ${res.classesNeeded}`);
  assert(res.projectedPercentage === 75, `projected percentage should be 75, got ${res.projectedPercentage}`);
}

// Test 3: Recovery with remaining classes limit:
// Needs 10 classes, but only 8 classes remain -> IMPOSSIBLE_REMAINING_LIMIT
{
  const res = calculateRecovery(20, 30, 75, 8);
  assert(res.status === "IMPOSSIBLE_REMAINING_LIMIT", "Needs 10 but 8 remain -> IMPOSSIBLE_REMAINING_LIMIT");
  // Max possible: (20 + 8) / (30 + 8) = 28 / 38 = 73.68%
  assert(res.maxPossiblePercentage === 73.68, `max possible should be 73.68, got ${res.maxPossiblePercentage}`);
}

// Test 4: Recovery with remaining classes limit reachable:
// Needs 10 classes, 15 classes remain -> RECOVERABLE
{
  const res = calculateRecovery(20, 30, 75, 15);
  assert(res.status === "RECOVERABLE", "Needs 10 and 15 remain -> RECOVERABLE");
  assert(res.classesNeeded === 10, "classesNeeded is 10");
}

// Test 5: Impossible target 100% when 1 missed
{
  const res = calculateRecovery(23, 28, 100);
  assert(res.status === "IMPOSSIBLE_TARGET", "Target 100% with missed classes is IMPOSSIBLE_TARGET");
}

// Test 6: Zero classes edge case
{
  const res = calculateRecovery(0, 0, 75);
  assert(res.status === "NO_CLASSES", "0/0 is NO_CLASSES");
}

// Test 7: Simulator: 23 / 28, bunk 1
// Result: 23 / 29 = 79.31%
{
  const sim = simulateAttendance(23, 28, 0, 1, 75);
  assert(sim.projectedAttended === 23, "Attended stays 23");
  assert(sim.projectedTotal === 29, "Total becomes 29");
  assert(sim.projectedPercentage === 79.31, `Projected % should be 79.31, got ${sim.projectedPercentage}`);
  assert(sim.deltaPercentage === -2.83, `Delta should be -2.83, got ${sim.deltaPercentage}`);
  assert(sim.isAboveTarget === true, "79.31% is above 75%");
}

// Test 8: Simulator: 23 / 28, attend 4, bunk 2
// Result: (23 + 4) / (28 + 4 + 2) = 27 / 34 = 79.41%
{
  const sim = simulateAttendance(23, 28, 4, 2, 75);
  assert(sim.projectedAttended === 27, "Attended becomes 27");
  assert(sim.projectedTotal === 34, "Total becomes 34");
  assert(sim.projectedPercentage === 79.41, `Projected % should be 79.41, got ${sim.projectedPercentage}`);
  assert(sim.isAboveTarget === true, "79.41% is above 75%");
}

// Test 9: Simulator: Bunk until below target
// 23 / 28 (82.14%), target 75%, bunk 5 -> 23 / 33 = 69.70% -> below target, must attend 7 to recover
{
  const sim = simulateAttendance(23, 28, 0, 5, 75);
  assert(sim.projectedPercentage === 69.7, `Projected % should be 69.7, got ${sim.projectedPercentage}`);
  assert(sim.isAboveTarget === false, "69.70% is below 75%");
  assert(sim.mustAttendRemaining === 7, `Must attend should be 7, got ${sim.mustAttendRemaining}`);
}

console.log("\n ALL ATTENDANCE CALCULATOR TESTS PASSED!");
