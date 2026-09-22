import { describe, it, expect } from "vitest";
import {
  calculateRemainingClasses,
  buildLogicalSessionsForDay,
  areTimesContiguous,
  addDays,
  getDayOfWeekFromDateStr,
  getDatePartsInTimezone,
  type UniversalTimetableEntry,
  type UniversalCalculationInput,
} from "../src/lib/date-iteration-engine";

describe("Universal Date-Iteration Engine", () => {
  // -------------------------------------------------------------------------
  // 1. Pure Date & Time Arithmetic
  // -------------------------------------------------------------------------
  describe("Pure Date Arithmetic & Timezone Utilities", () => {
    it("safely adds days without timezone drift across month boundaries", () => {
      expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
      expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    });

    it("correctly identifies day of week (1=Mon ... 7=Sun)", () => {
      // 2026-09-22 is Tuesday (2)
      expect(getDayOfWeekFromDateStr("2026-09-22")).toBe(2);
      // 2026-09-21 is Monday (1)
      expect(getDayOfWeekFromDateStr("2026-09-21")).toBe(1);
      // 2026-09-27 is Sunday (7)
      expect(getDayOfWeekFromDateStr("2026-09-27")).toBe(7);
      // 2026-09-26 is Saturday (6)
      expect(getDayOfWeekFromDateStr("2026-09-26")).toBe(6);
    });

    it("formats dates deterministically in configured timezones", () => {
      const partsKolkata = getDatePartsInTimezone(
        "2026-09-22T10:00:00.000Z",
        "Asia/Kolkata"
      );
      // 10:00 UTC + 5:30 = 15:30 Kolkata
      expect(partsKolkata.dateStr).toBe("2026-09-22");
      expect(partsKolkata.timeStr).toBe("15:30");
      expect(partsKolkata.dayOfWeek).toBe(2);

      const partsNY = getDatePartsInTimezone(
        "2026-09-22T10:00:00.000Z",
        "America/New_York"
      );
      // 10:00 UTC - 4:00 (EDT) = 06:00 NY
      expect(partsNY.dateStr).toBe("2026-09-22");
      expect(partsNY.timeStr).toBe("06:00");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Multi-Period Session-Based Deduplication
  // -------------------------------------------------------------------------
  describe("Multi-Period Session Deduplication", () => {
    it("detects contiguous times correctly", () => {
      expect(areTimesContiguous("11:30", "11:30")).toBe(true);
      expect(areTimesContiguous("11:30", "11:35")).toBe(true); // small transition
      expect(areTimesContiguous("09:50", "14:00")).toBe(false); // hours apart
    });

    it("merges contiguous periods of the same subject & group into 1 session", () => {
      const entries: UniversalTimetableEntry[] = [
        {
          dayOfWeek: 3,
          subjectCode: "CS-LAB",
          subjectName: "Computer Networks Lab",
          startTime: "10:40",
          endTime: "11:30",
          batch: "G1",
          isLab: true,
        },
        {
          dayOfWeek: 3,
          subjectCode: "CS-LAB",
          subjectName: "Computer Networks Lab",
          startTime: "11:30",
          endTime: "12:20",
          batch: "G1",
          isLab: true,
        },
      ];

      const sessions = buildLogicalSessionsForDay(entries);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].startTime).toBe("10:40");
      expect(sessions[0].endTime).toBe("12:20");
    });

    it("keeps separate morning and afternoon periods of the same subject as 2 distinct sessions", () => {
      const entries: UniversalTimetableEntry[] = [
        {
          dayOfWeek: 2,
          subjectCode: "MATH-101",
          subjectName: "Mathematics",
          startTime: "09:00",
          endTime: "09:50",
          isLab: false,
        },
        {
          dayOfWeek: 2,
          subjectCode: "MATH-101",
          subjectName: "Mathematics",
          startTime: "14:00",
          endTime: "14:50",
          isLab: false,
        },
      ];

      const sessions = buildLogicalSessionsForDay(entries);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].startTime).toBe("09:00");
      expect(sessions[1].startTime).toBe("14:00");
    });

    it("keeps simultaneous different group labs separate", () => {
      const entries: UniversalTimetableEntry[] = [
        {
          dayOfWeek: 3,
          subjectCode: "DS-LAB",
          subjectName: "Data Structures Lab",
          startTime: "10:40",
          endTime: "12:20",
          batch: "G1",
          isLab: true,
        },
        {
          dayOfWeek: 3,
          subjectCode: "WEB-LAB",
          subjectName: "Web Designing Lab",
          startTime: "10:40",
          endTime: "12:20",
          batch: "G2",
          isLab: true,
        },
      ];

      const sessions = buildLogicalSessionsForDay(entries);
      expect(sessions).toHaveLength(2);
      const ds = sessions.find((s) => s.subjectCode === "DS-LAB");
      const web = sessions.find((s) => s.subjectCode === "WEB-LAB");
      expect(ds?.groups).toEqual(["G1"]);
      expect(web?.groups).toEqual(["G2"]);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Universality Tests: 3 Distinct Institutional Configurations
  // -------------------------------------------------------------------------
  describe("Universality Test with 3 Distinct Configurations", () => {
    // Configuration A: AGC BCA-3-B Style Schedule (Tue-Fri working, Mon off, G1/G2 lab batches)
    it("Configuration A: Accurately counts classes for AGC-like schedule with lab groups G1 and G2", () => {
      const timetable: UniversalTimetableEntry[] = [
        // Tuesday Theory
        { dayOfWeek: 2, subjectCode: "CN", subjectName: "Computer Networks", startTime: "11:30", endTime: "12:20" },
        { dayOfWeek: 2, subjectCode: "DS", subjectName: "Data Structures", startTime: "09:00", endTime: "09:50" },
        // Wednesday Labs
        { dayOfWeek: 3, subjectCode: "DS-LAB", subjectName: "Data Structures Lab", startTime: "10:40", endTime: "12:20", batch: "G1", isLab: true },
        { dayOfWeek: 3, subjectCode: "WEB-LAB", subjectName: "Web Lab", startTime: "10:40", endTime: "12:20", batch: "G2", isLab: true },
        // Thursday Labs
        { dayOfWeek: 4, subjectCode: "WEB-LAB", subjectName: "Web Lab", startTime: "13:10", endTime: "14:50", batch: "G1", isLab: true },
        { dayOfWeek: 4, subjectCode: "CN-LAB", subjectName: "Computer Networks Lab", startTime: "13:10", endTime: "14:50", batch: "G2", isLab: true },
        // Friday Labs
        { dayOfWeek: 5, subjectCode: "CN-LAB", subjectName: "Computer Networks Lab", startTime: "10:40", endTime: "12:20", batch: "G1", isLab: true },
        { dayOfWeek: 5, subjectCode: "DS-LAB", subjectName: "Data Structures Lab", startTime: "10:40", endTime: "12:20", batch: "G2", isLab: true },
      ];

      const inputG1: UniversalCalculationInput = {
        now: "2026-10-01T08:00:00.000Z", // Thursday morning
        timezone: "Asia/Kolkata",
        calendar: {
          teachingEndDate: "2026-10-15", // 2 weeks window
          workingDays: [2, 3, 4, 5],
          excludedDays: [1, 6, 7], // Mon, Sat, Sun off
          holidays: [{ date: "2026-10-02", name: "Gandhi Jayanti" }], // Friday Oct 2 is holiday
        },
        timetable,
        studentContext: { group: "G1" },
      };

      const resultG1 = calculateRemainingClasses(inputG1);
      expect(resultG1.requestedGroup).toBe("G1");

      // For G1, Oct 2 Friday is holiday, so Friday CN-LAB on Oct 2 is skipped!
      // Only Friday Oct 9 remains for CN-LAB in this window -> exactly 1 CN-LAB
      expect(resultG1.bySubject["CN-LAB"].remainingClasses).toBe(1);

      // Now calculate for G2 with same calendar data
      const inputG2: UniversalCalculationInput = {
        ...inputG1,
        studentContext: { group: "G2" },
      };
      const resultG2 = calculateRemainingClasses(inputG2);
      expect(resultG2.requestedGroup).toBe("G2");

      // For G2: Thursday CN-LAB occurs on Oct 1, Oct 8, and Oct 15 (inclusive) -> exactly 3 CN-LABs!
      // (This proves Thursday CN-LAB for G2 is NEVER zero!)
      expect(resultG2.bySubject["CN-LAB"].remainingClasses).toBe(3);
      expect(resultG2.bySubject["CN-LAB"].isGroupDivided).toBe(true);
      expect(resultG2.bySubject["CN-LAB"].remainingByGroup!["G2"]).toBe(3);
      expect(resultG2.bySubject["CN-LAB"].remainingByGroup!["G1"]).toBe(1);
    });

    // Configuration B: Standard Mon-Fri College with No Lab Groups
    it("Configuration B: Works for a standard Mon-Fri university with zero lab groups", () => {
      const timetable: UniversalTimetableEntry[] = [
        { dayOfWeek: 1, subjectCode: "PHY101", subjectName: "Physics", startTime: "10:00", endTime: "11:00" },
        { dayOfWeek: 2, subjectCode: "PHY101", subjectName: "Physics", startTime: "10:00", endTime: "11:00" },
        { dayOfWeek: 3, subjectCode: "CHM101", subjectName: "Chemistry", startTime: "10:00", endTime: "11:00" },
        { dayOfWeek: 4, subjectCode: "CHM101", subjectName: "Chemistry", startTime: "10:00", endTime: "11:00" },
        { dayOfWeek: 5, subjectCode: "MTH101", subjectName: "Calculus", startTime: "10:00", endTime: "11:00" },
      ];

      const input: UniversalCalculationInput = {
        now: "2026-11-01T08:00:00.000Z", // Sunday
        timezone: "America/New_York",
        calendar: {
          teachingEndDate: "2026-11-14", // Exactly 2 weeks
          workingDays: [1, 2, 3, 4, 5],
          excludedDays: [6, 7], // Saturday, Sunday off
          holidays: [{ date: "2026-11-11", name: "Veterans Day" }], // Wednesday Nov 11 is off
        },
        timetable,
      };

      const result = calculateRemainingClasses(input);
      expect(result.timezone).toBe("America/New_York");
      // Physics: 2 per week * 2 weeks = 4
      expect(result.bySubject["PHY101"].remainingClasses).toBe(4);
      // Chemistry: Wed & Thu each week, but Wed Nov 11 is holiday -> 4 - 1 = 3
      expect(result.bySubject["CHM101"].remainingClasses).toBe(3);
      // Calculus: 1 per week on Friday * 2 weeks = 2
      expect(result.bySubject["MTH101"].remainingClasses).toBe(2);
      expect(result.theoryRemaining).toBe(9);
    });

    // Configuration C: College with Saturday Working, Custom Holidays & 3 Batches
    it("Configuration C: College with Saturday classes, custom holidays, and 3 batches (Batch-A, Batch-B, Batch-C)", () => {
      const timetable: UniversalTimetableEntry[] = [
        { dayOfWeek: 6, subjectCode: "ROBO-LAB", subjectName: "Robotics Lab", startTime: "09:00", endTime: "11:00", batch: "Batch-A", isLab: true },
        { dayOfWeek: 6, subjectCode: "ROBO-LAB", subjectName: "Robotics Lab", startTime: "11:30", endTime: "13:30", batch: "Batch-B", isLab: true },
        { dayOfWeek: 6, subjectCode: "ROBO-LAB", subjectName: "Robotics Lab", startTime: "14:00", endTime: "16:00", batch: "Batch-C", isLab: true },
      ];

      const input: UniversalCalculationInput = {
        now: "2026-10-01T08:00:00.000Z",
        timezone: "Asia/Tokyo",
        calendar: {
          teachingEndDate: "2026-10-31", // 4 Saturdays in Oct 2026: Oct 3, 10, 17, 24, 31 (5 Saturdays)
          workingDays: [1, 2, 3, 4, 5, 6], // Saturday is working!
          excludedDays: [7], // Only Sunday off
          holidays: [{ date: "2026-10-17", name: "Sports Day" }], // Oct 17 is holiday
        },
        timetable,
        studentContext: { group: "Batch-B" },
      };

      const result = calculateRemainingClasses(input);
      expect(result.allDiscoveredGroups).toContain("BATCH-B");
      // 5 Saturdays in Oct, minus Oct 17 holiday = 4 sessions for Batch-B
      expect(result.bySubject["ROBO-LAB"].remainingClasses).toBe(4);
      expect(result.bySubject["ROBO-LAB"].isGroupDivided).toBe(true);
      expect(result.bySubject["ROBO-LAB"].remainingByGroup!["BATCH-B"]).toBe(4);
      expect(result.bySubject["ROBO-LAB"].remainingByGroup!["BATCH-A"]).toBe(4);
      expect(result.bySubject["ROBO-LAB"].remainingByGroup!["BATCH-C"]).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Cross-Department Test (BCA vs B.Tech)
  // -------------------------------------------------------------------------
  describe("Cross-Department Independence", () => {
    it("ensures BCA timetable and B.Tech timetable produce completely independent results", () => {
      const bcaTimetable: UniversalTimetableEntry[] = [
        { dayOfWeek: 2, subjectCode: "BCA-DS", subjectName: "BCA Data Structures", startTime: "09:00", endTime: "09:50" },
      ];
      const btechTimetable: UniversalTimetableEntry[] = [
        { dayOfWeek: 2, subjectCode: "CSE-AI", subjectName: "B.Tech Artificial Intelligence", startTime: "09:00", endTime: "09:50" },
        { dayOfWeek: 4, subjectCode: "CSE-VLSI", subjectName: "B.Tech VLSI", startTime: "10:00", endTime: "11:00" },
      ];

      const cal = {
        teachingEndDate: "2026-10-15",
        workingDays: [2, 4],
      };

      const bcaResult = calculateRemainingClasses({
        now: "2026-10-01T08:00:00.000Z",
        calendar: cal,
        timetable: bcaTimetable,
      });

      const btechResult = calculateRemainingClasses({
        now: "2026-10-01T08:00:00.000Z",
        calendar: cal,
        timetable: btechTimetable,
      });

      expect(bcaResult.bySubject["BCA-DS"]).toBeDefined();
      expect(bcaResult.bySubject["CSE-AI"]).toBeUndefined();

      expect(btechResult.bySubject["CSE-AI"]).toBeDefined();
      expect(btechResult.bySubject["CSE-VLSI"]).toBeDefined();
      expect(btechResult.bySubject["BCA-DS"]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Unknown Group Handling & Zero Value Normalization
  // -------------------------------------------------------------------------
  describe("Unknown Group Behavior & Zero Value Guarantee", () => {
    it("does not guess when group is Unknown and provides clean breakdown", () => {
      const timetable: UniversalTimetableEntry[] = [
        { dayOfWeek: 3, subjectCode: "LAB-1", subjectName: "Hardware Lab", startTime: "10:00", endTime: "12:00", batch: "G1", isLab: true },
        { dayOfWeek: 5, subjectCode: "LAB-1", subjectName: "Hardware Lab", startTime: "10:00", endTime: "12:00", batch: "G2", isLab: true },
      ];

      const result = calculateRemainingClasses({
        now: "2026-10-01T08:00:00.000Z",
        calendar: {
          teachingEndDate: "2026-10-15",
          workingDays: [3, 5],
          holidays: [{ date: "2026-10-02", name: "Holiday" }], // Friday Oct 2 off
        },
        timetable,
        studentContext: { group: "Unknown" },
      });

      const subj = result.bySubject["LAB-1"];
      expect(subj).toBeDefined();
      expect(subj.isGroupDivided).toBe(true);
      expect(subj.remainingByGroup).not.toBeNull();
      expect(typeof subj.remainingByGroup!["G1"]).toBe("number");
      expect(typeof subj.remainingByGroup!["G2"]).toBe("number");
      // G1 had 2 Wednesdays (Oct 7, Oct 14)
      expect(subj.remainingByGroup!["G1"]).toBe(2);
      // G2 had 1 Friday (Oct 9, since Oct 2 was holiday)
      expect(subj.remainingByGroup!["G2"]).toBe(1);
    });

    it("returns real numeric 0 when 0 classes remain (never null or undefined)", () => {
      const timetable: UniversalTimetableEntry[] = [
        { dayOfWeek: 1, subjectCode: "SUBJ-ZERO", subjectName: "Completed Course", startTime: "09:00", endTime: "10:00" },
      ];

      // Teaching ended yesterday
      const result = calculateRemainingClasses({
        now: "2026-11-10T08:00:00.000Z",
        calendar: {
          teachingEndDate: "2026-11-09", // already passed
          workingDays: [1],
        },
        timetable,
      });

      const subj = result.bySubject["SUBJ-ZERO"];
      expect(subj).toBeDefined();
      expect(subj.remainingClasses).toBe(0);
      expect(subj.remainingClasses).not.toBeNull();
      expect(subj.remainingClasses).not.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Exceptions (Cancellations and Makeups)
  // -------------------------------------------------------------------------
  describe("Schedule Exceptions Precedence", () => {
    it("skips cancelled classes and includes explicit makeup classes", () => {
      const timetable: UniversalTimetableEntry[] = [
        { dayOfWeek: 2, subjectCode: "CHEM", subjectName: "Chemistry", startTime: "10:00", endTime: "11:00" },
      ];

      const result = calculateRemainingClasses({
        now: "2026-10-01T08:00:00.000Z",
        calendar: {
          teachingEndDate: "2026-10-15", // Tuesdays: Oct 6, Oct 13 (2 total)
          workingDays: [2],
        },
        timetable,
        exceptions: [
          { date: "2026-10-06", type: "CANCELLED", subjectCode: "CHEM", reason: "Faculty sick leave" },
          {
            date: "2026-10-10", // Saturday makeup
            type: "MAKEUP",
            replacementEntries: [
              { dayOfWeek: 6, subjectCode: "CHEM", subjectName: "Chemistry", startTime: "10:00", endTime: "11:00" },
            ],
          },
        ],
      });

      // Normal Oct 6 cancelled (-1), Oct 10 makeup added (+1), Oct 13 held normally = 2 total
      expect(result.bySubject["CHEM"].remainingClasses).toBe(2);
      expect(result.bySubject["CHEM"].countedDates).toContain("2026-10-10");
      expect(result.bySubject["CHEM"].countedDates).toContain("2026-10-13");
      expect(result.bySubject["CHEM"].countedDates).not.toContain("2026-10-06");
    });
  });
});
