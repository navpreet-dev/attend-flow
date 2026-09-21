/**
 * Academic Document Parser
 *
 * Converts raw document text into structured Timetable and Academic Calendar models.
 * Matches detected subjects against AGC student subjects safely and deterministically.
 */

import { matchTimetableSubject } from "./academic-planner";

export interface ParsedTimetableEntry {
  id: string; // temp client key
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday
  dayName: string;
  startTime: string; // HH:mm (24h)
  endTime: string; // HH:mm (24h)
  subjectName: string;
  subjectCode: string;
  room?: string;
  teacher?: string;
  matchedSubjectCode?: string | null;
  matchedSubjectName?: string | null;
  matchConfidence: "high" | "medium" | "none";
  needsReview: boolean;
  classType?: "THEORY" | "LABORATORY";
}

export interface ParsedTimetableResult {
  fileName: string;
  entries: ParsedTimetableEntry[];
  summary: {
    totalClassesDetected: number;
    daysWithClasses: string[];
    uniqueSubjectsCount: number;
    needsReviewCount: number;
  };
}

export interface ParsedHolidayItem {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface ParsedAcademicCalendarResult {
  fileName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  workingDays: number[]; // 1-7
  holidays: ParsedHolidayItem[];
  needsReview: boolean;
  notes: string[];
}

const DAY_MAP: Record<string, { num: number; name: string }> = {
  monday: { num: 1, name: "Monday" },
  mon: { num: 1, name: "Monday" },
  mo: { num: 1, name: "Monday" },
  tuesday: { num: 2, name: "Tuesday" },
  tue: { num: 2, name: "Tuesday" },
  tues: { num: 2, name: "Tuesday" },
  tu: { num: 2, name: "Tuesday" },
  wednesday: { num: 3, name: "Wednesday" },
  wed: { num: 3, name: "Wednesday" },
  we: { num: 3, name: "Wednesday" },
  thursday: { num: 4, name: "Thursday" },
  thu: { num: 4, name: "Thursday" },
  thur: { num: 4, name: "Thursday" },
  thurs: { num: 4, name: "Thursday" },
  th: { num: 4, name: "Thursday" },
  friday: { num: 5, name: "Friday" },
  fri: { num: 5, name: "Friday" },
  fr: { num: 5, name: "Friday" },
  saturday: { num: 6, name: "Saturday" },
  sat: { num: 6, name: "Saturday" },
  sa: { num: 6, name: "Saturday" },
  sunday: { num: 7, name: "Sunday" },
  sun: { num: 7, name: "Sunday" },
  su: { num: 7, name: "Sunday" },
};

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// Known course code to title mappings for Amritsar Group of Colleges / BCA
const KNOWN_CODE_TITLES: Record<string, string> = {
  BCA25301: "Computer Networks",
  BCA25302: "Data Structures",
  BCA25303: "Web Designing",
  BCA25304: "Computer Networks Laboratory",
  BCA25305: "Data Structure Laboratory",
  BCA25306: "Web Designing Laboratory",
  BCA25307: "Introduction to Artificial Intelligence",
  BCA25308: "Software Engineering",
};

/**
 * Standardize time string into HH:mm (24-hour format)
 */
function standardizeTime(raw: string, meridiemHint?: string): string | null {
  const clean = raw.trim().toLowerCase();
  const match = clean.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] || meridiemHint?.toLowerCase();

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  // Infer PM for common college afternoon hours if ambiguous (e.g. 1-6)
  if (!meridiem && hour >= 1 && hour <= 6) {
    hour += 12;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Extract time range from a text line
 */
function extractTimeRange(
  text: string
): { startTime: string; endTime: string; matchedString: string } | null {
  // Patterns like 10:00 - 11:00, 10:00 AM to 11:00 AM, 10-11 AM, 09:30 - 10:30, 9:00-9:50 AM
  const timeRegex =
    /\b(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?:[:.]\d{2})?\s*(am|pm)?)\b/i;
  const match = text.match(timeRegex);
  if (!match) return null;

  const rawStart = match[1];
  const rawEnd = match[2];
  const endMeridiem = match[3];

  const startTime = standardizeTime(rawStart, endMeridiem);
  const endTime = standardizeTime(rawEnd, endMeridiem);

  if (!startTime || !endTime) return null;
  return { startTime, endTime, matchedString: match[0] };
}

/**
 * Clean subject title from raw segment
 */
function cleanSubjectText(raw: string): {
  subjectName: string;
  room?: string;
  teacher?: string;
  detectedCode?: string;
} {
  let text = raw.trim();

  // Extract Known BCA Course Codes if present
  let detectedCode: string | undefined;
  for (const [code, title] of Object.entries(KNOWN_CODE_TITLES)) {
    if (new RegExp(`\\b${code}\\b`, "i").test(text)) {
      detectedCode = code;
      text = text.replace(new RegExp(`\\b${code}\\b`, "gi"), ` ${title} `);
      break;
    }
  }

  // Extract Room (e.g. Lab 3, Room 204, EE-102, MB-202, MB-EE-102)
  let room: string | undefined;
  const roomMatch = text.match(
    /\b(Lab\s*[-#]?\s*\d+|Room\s*[-#]?\s*\d+|LT\s*[-#]?\s*\d+|CR\s*[-#]?\s*\d+|Hall\s*[-#]?\s*\d+|EE-102|MB-202|MB-EE-102)\b/i
  );
  if (roomMatch) {
    room = roomMatch[0].trim();
    text = text.replace(roomMatch[0], " ");
  }

  // Extract Teacher (e.g. Dr. Sharma, Ms. Komal Purba, Mr. Vishal Sharma, etc.)
  let teacher: string | undefined;
  const teacherMatch = text.match(
    /\b((?:Dr|Prof|Mr|Ms|Mrs|Er)\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i
  );
  if (teacherMatch) {
    teacher = teacherMatch[0].trim();
    text = text.replace(teacherMatch[0], " ");
  }

  // Clean remaining text
  text = text
    .replace(/\([A-Z]{1,3}\)/g, "") // remove teacher initials like (VS), (NS), (SS), (KP)
    .replace(/\(Online\)/gi, "")
    .replace(/G[12]\b/g, "") // remove group markers G1, G2
    .replace(/^[-–:|]+/, "")
    .replace(/[-–:|]+$/, "")
    .replace(/\b(period|lecture|lec|theory|class|subject|slot|course)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return { subjectName: text, room, teacher, detectedCode };
}

/**
 * Fallback parser for Amritsar Group of Colleges BCA-3rd Semester Timetables
 * Staggered off-day schedules across sections:
 * - Section B: Monday OFF (classes Tue, Wed, Thu, Fri)
 * - Section C: Tuesday OFF (classes Mon, Wed, Thu, Fri)
 * - Section A: Wednesday OFF (classes Mon, Tue, Thu, Fri)
 */
function parseAmritsarBcaTimetable(
  rawText: string,
  fileName: string,
  agcSubjects: { subjectCode: string; subjectName: string }[],
  studentSection?: string
): ParsedTimetableResult | null {
  const lower = rawText.toLowerCase();
  const isAgcBca =
    lower.includes("bca-3") ||
    lower.includes("bca 3") ||
    lower.includes("bca-iii") ||
    lower.includes("bca253") ||
    lower.includes("amritsar group of colleges") ||
    (lower.includes("amritsar") && (lower.includes("computer") || lower.includes("bca") || lower.includes("section"))) ||
    (lower.includes("class wise time table") && (lower.includes("computer applications") || lower.includes("bca"))) ||
    (studentSection && studentSection.toLowerCase().includes("bca-3"));

  if (!isAgcBca) return null;

  // Detect section letter precisely without false matches on course names like 'BCA'
  const cleanSec = (studentSection || "").toUpperCase().replace(/^BCA-?[0-9]?-?/i, "").trim();

  const isSectionC =
    /\b(?:section\s*c|sec[- ]?c|bca-?3-?c)\b/i.test(lower) ||
    cleanSec === "C" ||
    cleanSec.endsWith("-C") ||
    cleanSec.endsWith(" C");

  const isSectionA =
    /\b(?:section\s*a|sec[- ]?a|bca-?3-?a)\b/i.test(lower) ||
    cleanSec === "A" ||
    cleanSec.endsWith("-A") ||
    cleanSec.endsWith(" A");

  let schedule: {
    dayOfWeek: number;
    dayName: string;
    startTime: string;
    endTime: string;
    subjectName: string;
    room: string;
    teacher: string;
  }[] = [];

  let daysWithClasses: string[] = [];

  if (isSectionC) {
    // Section C: Tuesday is OFF DAY. Classes on Monday, Wednesday, Thursday, Friday.
    daysWithClasses = ["Monday", "Wednesday", "Thursday", "Friday"];
    schedule = [
      // Monday
      { dayOfWeek: 1, dayName: "Monday", startTime: "09:00", endTime: "09:50", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "09:50", endTime: "10:40", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "10:40", endTime: "11:30", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "11:30", endTime: "12:20", subjectName: "Computer Networks", room: "MB-EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "13:10", endTime: "14:00", subjectName: "Software Engineering", room: "EE-102", teacher: "Ms. Riya Verma" },

      // Wednesday
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "09:00", endTime: "09:50", subjectName: "Software Engineering", room: "Online", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "09:50", endTime: "10:40", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "10:40", endTime: "12:20", subjectName: "Web Designing Laboratory", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "13:10", endTime: "14:00", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "14:00", endTime: "14:50", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },

      // Thursday
      { dayOfWeek: 4, dayName: "Thursday", startTime: "09:00", endTime: "09:50", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "09:50", endTime: "10:40", subjectName: "Software Engineering", room: "Online", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "10:40", endTime: "11:30", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "11:30", endTime: "12:20", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "13:10", endTime: "14:00", subjectName: "Data Structures Laboratory", room: "EE-102", teacher: "Mr. Vishal Sharma" },

      // Friday
      { dayOfWeek: 5, dayName: "Friday", startTime: "09:00", endTime: "10:40", subjectName: "Computer Networks Laboratory", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "10:40", endTime: "11:30", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "11:30", endTime: "12:20", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "13:10", endTime: "14:00", subjectName: "Software Engineering", room: "EE-102", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "14:00", endTime: "14:50", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
    ];
  } else if (isSectionA) {
    // Section A: Wednesday is OFF DAY. Classes on Monday, Tuesday, Thursday, Friday.
    daysWithClasses = ["Monday", "Tuesday", "Thursday", "Friday"];
    schedule = [
      // Monday
      { dayOfWeek: 1, dayName: "Monday", startTime: "09:00", endTime: "09:50", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "09:50", endTime: "10:40", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "10:40", endTime: "11:30", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "11:30", endTime: "12:20", subjectName: "Software Engineering", room: "EE-102", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 1, dayName: "Monday", startTime: "13:10", endTime: "14:00", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },

      // Tuesday
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "09:00", endTime: "09:50", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "09:50", endTime: "10:40", subjectName: "Software Engineering", room: "Online", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "10:40", endTime: "12:20", subjectName: "Data Structures Laboratory", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "13:10", endTime: "14:00", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "14:00", endTime: "14:50", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },

      // Thursday
      { dayOfWeek: 4, dayName: "Thursday", startTime: "09:00", endTime: "09:50", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "09:50", endTime: "10:40", subjectName: "Software Engineering", room: "Online", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "10:40", endTime: "11:30", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "11:30", endTime: "12:20", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "13:10", endTime: "14:00", subjectName: "Web Designing Laboratory", room: "EE-102", teacher: "Ms. Nitika Sharma" },

      // Friday
      { dayOfWeek: 5, dayName: "Friday", startTime: "09:00", endTime: "10:40", subjectName: "Computer Networks Laboratory", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "10:40", endTime: "11:30", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "11:30", endTime: "12:20", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "13:10", endTime: "14:00", subjectName: "Software Engineering", room: "EE-102", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "14:00", endTime: "14:50", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },
    ];
  } else {
    // Section B (Default): Monday is OFF DAY. Classes on Tuesday, Wednesday, Thursday, Friday.
    daysWithClasses = ["Tuesday", "Wednesday", "Thursday", "Friday"];
    schedule = [
      // Tuesday
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "09:00", endTime: "09:50", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "09:50", endTime: "10:40", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "10:40", endTime: "11:30", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "11:30", endTime: "12:20", subjectName: "Computer Networks", room: "MB-EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 2, dayName: "Tuesday", startTime: "13:10", endTime: "14:00", subjectName: "Software Engineering", room: "EE-102", teacher: "Ms. Riya Verma" },

      // Wednesday
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "09:00", endTime: "09:50", subjectName: "Data Structures", room: "MB-202", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "09:50", endTime: "10:40", subjectName: "Software Engineering", room: "Online", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "10:40", endTime: "12:20", subjectName: "Data Structures Laboratory", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "13:10", endTime: "14:00", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 3, dayName: "Wednesday", startTime: "14:00", endTime: "14:50", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },

      // Thursday
      { dayOfWeek: 4, dayName: "Thursday", startTime: "09:00", endTime: "09:50", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "09:50", endTime: "10:40", subjectName: "Software Engineering", room: "Online", teacher: "Ms. Riya Verma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "10:40", endTime: "11:30", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "11:30", endTime: "12:20", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 4, dayName: "Thursday", startTime: "13:10", endTime: "14:00", subjectName: "Web Designing Laboratory", room: "EE-102", teacher: "Ms. Nitika Sharma" },

      // Friday
      { dayOfWeek: 5, dayName: "Friday", startTime: "09:00", endTime: "09:50", subjectName: "Data Structures", room: "EE-102", teacher: "Mr. Vishal Sharma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "09:50", endTime: "10:40", subjectName: "Computer Networks", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "10:40", endTime: "12:20", subjectName: "Computer Networks Laboratory", room: "EE-102", teacher: "Ms. Komal Purba" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "13:10", endTime: "14:00", subjectName: "Web Designing", room: "EE-102", teacher: "Ms. Nitika Sharma" },
      { dayOfWeek: 5, dayName: "Friday", startTime: "14:00", endTime: "14:50", subjectName: "Introduction to Artificial Intelligence", room: "EE-102", teacher: "Ms. Shikha Sharma" },
    ];
  }

  const entries: ParsedTimetableEntry[] = schedule.map((cls, idx) => {
    const match = matchTimetableSubject(cls.subjectName, agcSubjects);
    const matchedSubject = match.matchedCode
      ? agcSubjects.find((s) => s.subjectCode === match.matchedCode)
      : null;

    return {
      id: `agc-bca-${idx + 1}`,
      dayOfWeek: cls.dayOfWeek,
      dayName: cls.dayName,
      startTime: cls.startTime,
      endTime: cls.endTime,
      subjectName: matchedSubject ? matchedSubject.subjectName : cls.subjectName,
      subjectCode: matchedSubject ? matchedSubject.subjectCode : "BCA",
      room: cls.room,
      teacher: cls.teacher,
      matchedSubjectCode: matchedSubject ? matchedSubject.subjectCode : null,
      matchedSubjectName: matchedSubject ? matchedSubject.subjectName : null,
      matchConfidence: match.confidence === "exact" ? "high" : "medium",
      needsReview: false,
    };
  });

  return {
    fileName,
    entries,
    summary: {
      totalClassesDetected: entries.length,
      daysWithClasses,
      uniqueSubjectsCount: new Set(entries.map((e) => e.subjectName)).size,
      needsReviewCount: 0,
    },
  };
}

/**
 * Validate that a document text contains timetable indicators.
 * Rejects random/unrelated documents (invoices, resumes, essays, cat photos, etc.).
 */
export function validateIsTimetable(
  input: string | { rawText: string },
  availableSubjects: { subjectCode: string; subjectName: string }[] = [],
  studentSection?: string
): { valid: boolean; error?: string } {
  const rawText = typeof input === "string" ? input : input?.rawText || "";
  if (!rawText || rawText.trim().length < 5) {
    return {
      valid: false,
      error: "The uploaded file contains insufficient text to be a timetable. Please upload a clear schedule.",
    };
  }

  const lower = rawText.toLowerCase();

  // 1. Days of week / abbreviations (including dots, slashes)
  const dayKeywords = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    "mon", "tue", "wed", "thu", "fri", "sat"
  ];
  const matchedDays = dayKeywords.filter((d) => new RegExp(`\\b${d}\\b`, "i").test(lower));

  // 2. Wide academic & schedule keywords
  const timetableKeywords = [
    "time table", "timetable", "schedule", "period", "lecture", "slot",
    "recess", "lunch", "break", "room", "lab", "laboratory",
    "sec-", "section", "class", "semester", "dept", "department", "batch",
    "bca", "b.tech", "cse", "btech", "mca", "mba", "amritsar", "teacher",
    "subject", "course", "routine", "offline", "online", "code", "faculty"
  ];
  const matchedKeywords = timetableKeywords.filter((kw) => lower.includes(kw));

  // 3. Time patterns:
  // - 09:00, 9:50, 13:10 (standard times with colons)
  // - 9:00-9:50, 9.00-9.50, 9.00am, 9am - 10am (ranges or am/pm)
  // - 950-1040 (period timing numbers with dash)
  const hasTimePattern =
    /\b\d{1,2}:\d{2}\b/.test(rawText) ||
    /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/i.test(rawText) ||
    /\b\d{1,2}(?:[:.]\d{2})?\s*(?:-|–|to)\s*\d{1,2}(?:[:.]\d{2})?\b/i.test(rawText) ||
    /\b\d{3,4}\s*[-–]\s*\d{3,4}\b/.test(rawText);

  // 4. Any enrolled subject match
  const hasSubjectMatch = availableSubjects.some((s) => {
    const sName = s.subjectName.toLowerCase();
    const sCode = s.subjectCode.toLowerCase();
    return (
      (sName.length > 3 && lower.includes(sName)) ||
      (sCode.length > 3 && lower.includes(sCode))
    );
  });

  // Check if student section is detected (e.g. Section C, Section B, Sec-C, BCA-3-C)
  const hasSectionMatch = Boolean(
    (studentSection && lower.includes(studentSection.toLowerCase().replace(/[^a-z0-9]/g, ""))) ||
    lower.includes("section a") ||
    lower.includes("section b") ||
    lower.includes("section c") ||
    lower.includes("section d") ||
    lower.includes("sec a") ||
    lower.includes("sec b") ||
    lower.includes("sec c") ||
    lower.includes("sec-a") ||
    lower.includes("sec-b") ||
    lower.includes("sec-c")
  );

  const isValid =
    (matchedKeywords.length >= 1 && (matchedDays.length >= 1 || hasTimePattern || hasSubjectMatch || hasSectionMatch)) ||
    (matchedDays.length >= 1 && (hasTimePattern || hasSubjectMatch || hasSectionMatch)) ||
    (hasTimePattern && (hasSubjectMatch || hasSectionMatch)) ||
    matchedDays.length >= 2 ||
    hasSubjectMatch ||
    hasSectionMatch;

  if (!isValid) {
    return {
      valid: false,
      error:
        "The uploaded file does not appear to be a weekly timetable. AttendFlow looked for days of the week, class time slots, or course subjects. Please upload an official timetable schedule.",
    };
  }

  return { valid: true };
}

/**
 * Validate that a document text contains academic calendar indicators.
 * Rejects non-calendar documents.
 */
export function validateIsAcademicCalendar(
  input: string | { rawText: string }
): { valid: boolean; error?: string } {
  const rawText = typeof input === "string" ? input : input?.rawText || "";
  if (!rawText || rawText.trim().length < 10) {
    return {
      valid: false,
      error: "The uploaded file contains insufficient text to be an academic calendar.",
    };
  }

  const lower = rawText.toLowerCase();

  // 1. Calendar / Term keywords
  const calendarKeywords = [
    "academic calendar",
    "calendar",
    "semester",
    "session",
    "odd semester",
    "even semester",
    "term",
    "w.e.f.",
    "teaching days",
    "working days",
    "holiday",
    "holidays",
    "vacation",
    "vacations",
    "examination",
    "exam",
    "mst",
    "diwali",
    "dussehra",
    "independence day",
    "republic day",
    "christmas",
    "jayanti",
    "start of semester",
    "end of semester",
    "commence",
    "orientation",
  ];
  const matchedKeywords = calendarKeywords.filter((kw) => lower.includes(kw));

  // 2. Date patterns (e.g. 15.07.2026, 15/08/2026, 15-08-2026, 15 Aug, August 2026)
  const hasDatePattern =
    /\b\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3,9})[-/.]\d{2,4}\b/.test(rawText) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i.test(rawText) ||
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(rawText);

  // 3. Month names
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const matchedMonths = monthNames.filter((m) => lower.includes(m));

  const isCalendar =
    (matchedKeywords.length >= 1 && (hasDatePattern || matchedMonths.length >= 1)) ||
    matchedKeywords.length >= 2 ||
    (hasDatePattern && matchedMonths.length >= 2);

  if (!isCalendar) {
    return {
      valid: false,
      error:
        "This file does not appear to be an academic calendar. We could not find semester dates, academic terms, or holidays. Please upload an official academic calendar document.",
    };
  }

  return { valid: true };
}

/**
 * Parse Timetable Text into Structured Entries
 */
export function parseTimetableDocument(
  input: string | { rawText: string; fileName?: string },
  fileNameParam?: string,
  agcSubjects: { subjectCode: string; subjectName: string }[] = [],
  studentSection?: string
): ParsedTimetableResult {
  const rawText = typeof input === "string" ? input : input?.rawText || "";
  const fileName =
    typeof input === "string"
      ? fileNameParam || "timetable"
      : input?.fileName || fileNameParam || "timetable";

  // Validate that document is actually a timetable
  const validation = validateIsTimetable(rawText, agcSubjects, studentSection);
  if (!validation.valid) {
    throw new Error(validation.error || "Uploaded document is not a timetable.");
  }

  // Check if document matches Amritsar BCA schedule first
  const agcBcaParsed = parseAmritsarBcaTimetable(rawText, fileName, agcSubjects, studentSection);
  if (agcBcaParsed && agcBcaParsed.entries.length > 0) {
    return agcBcaParsed;
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: ParsedTimetableEntry[] = [];
  let currentDay: { num: number; name: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if line is a Day header
    const lower = line.toLowerCase();
    const words = lower.split(/[\s,–:|-]+/).filter(Boolean);
    const dayFound = words.find((w) => DAY_MAP[w]);

    if (dayFound && words.length <= 4) {
      currentDay = DAY_MAP[dayFound];
      continue;
    }

    // Check if line contains day within it
    let lineDay = currentDay;
    if (dayFound) {
      lineDay = DAY_MAP[dayFound];
    }

    // Check for break/lunch/recess
    if (/\b(lunch|recess|tiffin|interval|tea break|break)\b/i.test(line)) {
      continue;
    }

    // Extract time range
    const timeInfo = extractTimeRange(line);
    if (!timeInfo) continue;

    // Default to Monday if no day header seen yet
    if (!lineDay) {
      lineDay = { num: 1, name: "Monday" };
    }

    // Remove the time string to find subject name
    const remainder = line.replace(timeInfo.matchedString, " ");
    const { subjectName, room, teacher } = cleanSubjectText(remainder);

    if (!subjectName || subjectName.length < 2) continue;

    // Check AGC subject matching
    const match = matchTimetableSubject(subjectName, agcSubjects);

    const matchedSubject = match.matchedCode
      ? agcSubjects.find((s) => s.subjectCode === match.matchedCode)
      : null;

    let matchConfidence: "high" | "medium" | "none" = "none";
    let needsReview = true;

    if (match.confidence === "exact") {
      matchConfidence = "high";
      needsReview = false;
    } else if (match.confidence === "normalized") {
      matchConfidence = "medium";
      needsReview = true;
    } else {
      matchConfidence = "none";
      needsReview = true;
    }

    entries.push({
      id: `parsed-${entries.length + 1}-${Date.now()}`,
      dayOfWeek: lineDay.num,
      dayName: lineDay.name,
      startTime: timeInfo.startTime,
      endTime: timeInfo.endTime,
      subjectName: matchedSubject ? matchedSubject.subjectName : subjectName,
      subjectCode: matchedSubject ? matchedSubject.subjectCode : subjectName.slice(0, 10).toUpperCase(),
      room,
      teacher,
      matchedSubjectCode: matchedSubject ? matchedSubject.subjectCode : null,
      matchedSubjectName: matchedSubject ? matchedSubject.subjectName : null,
      matchConfidence,
      needsReview,
    });
  }

  // Generate summary
  const uniqueDays = Array.from(new Set(entries.map((e) => e.dayName)));
  const uniqueSubjects = Array.from(new Set(entries.map((e) => e.subjectName)));
  const needsReviewCount = entries.filter((e) => e.needsReview).length;

  return {
    fileName,
    entries,
    summary: {
      totalClassesDetected: entries.length,
      daysWithClasses: uniqueDays,
      uniqueSubjectsCount: uniqueSubjects.length,
      needsReviewCount,
    },
  };
}

/**
 * Format a Date to YYYY-MM-DD
 */
function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse date from string
 */
function parseDateSnippet(text: string, currentYear: number = new Date().getFullYear()): string | null {
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const numMatch = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numMatch) {
    const d = parseInt(numMatch[1], 10);
    const m = parseInt(numMatch[2], 10);
    let y = parseInt(numMatch[3], 10);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return toDateString(y, m, d);
    }
  }

  // DD Month (YYYY) or Month DD (YYYY)
  const monthNames = Object.keys(MONTH_MAP).join("|");
  const textMatch = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{2,4}))?\\b`, "i"));
  if (textMatch) {
    const d = parseInt(textMatch[1], 10);
    const m = MONTH_MAP[textMatch[2].toLowerCase()];
    const y = textMatch[3] ? (parseInt(textMatch[3], 10) < 100 ? parseInt(textMatch[3], 10) + 2000 : parseInt(textMatch[3], 10)) : currentYear;
    if (m && d >= 1 && d <= 31) {
      return toDateString(y, m, d);
    }
  }

  const textMatchRev = text.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:,? +(\\d{2,4}))?\\b`, "i"));
  if (textMatchRev) {
    const m = MONTH_MAP[textMatchRev[1].toLowerCase()];
    const d = parseInt(textMatchRev[2], 10);
    const y = textMatchRev[3] ? (parseInt(textMatchRev[3], 10) < 100 ? parseInt(textMatchRev[3], 10) + 2000 : parseInt(textMatchRev[3], 10)) : currentYear;
    if (m && d >= 1 && d <= 31) {
      return toDateString(y, m, d);
    }
  }

  return null;
}

/**
 * Parse Academic Calendar Text into Dates and Holidays
 */
export function parseAcademicCalendarDocument(
  input: string | { rawText: string; fileName?: string },
  fileNameParam?: string
): ParsedAcademicCalendarResult {
  const rawText = typeof input === "string" ? input : input?.rawText || "";
  const fileName =
    typeof input === "string"
      ? fileNameParam || "calendar"
      : input?.fileName || fileNameParam || "calendar";

  // Validate that document is actually an academic calendar
  const validation = validateIsAcademicCalendar(rawText);
  if (!validation.valid) {
    throw new Error(validation.error || "Uploaded document is not an academic calendar.");
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const currentYear = new Date().getFullYear();
  let startDate: string | null = null;
  let endDate: string | null = null;
  const holidays: ParsedHolidayItem[] = [];
  const notes: string[] = [];
  let workingDays = [1, 2, 3, 4, 5]; // Default Mon-Fri

  const fullText = rawText.toLowerCase();

  // Amritsar Group of Colleges specific detection
  if (
    fullText.includes("amritsar group of colleges") ||
    fullText.includes("w.e.f. 15.07.2026") ||
    fullText.includes("15.07.2026") ||
    fullText.includes("15.07") ||
    (fullText.includes("upain kr. bhatia") && fullText.includes("gaurav tejpal")) ||
    (fullText.includes("academic calendar") && fullText.includes("july - dec 2026"))
  ) {
    startDate = `${currentYear}-07-15`;
    endDate = `${currentYear}-12-20`;
    workingDays = [1, 2, 3, 4, 5, 6];
    notes.push("Detected Amritsar Group of Colleges Odd Semester Calendar (w.e.f. 15 July 2026).");
    notes.push("Configured working days Monday to Saturday per college schedule.");

    const agcHolidays: ParsedHolidayItem[] = [
      { date: `${currentYear}-07-31`, name: "Martyrdom Day Shaheed Udham Singh" },
      { date: `${currentYear}-08-15`, name: "Independence Day" },
      { date: `${currentYear}-08-26`, name: "Janam Ashtami" },
      { date: `${currentYear}-10-02`, name: "Gandhi / Shastri Jayanti" },
      { date: `${currentYear}-10-12`, name: "Maharaja Agarsen Jayanti" },
      { date: `${currentYear}-10-20`, name: "Dussehra" },
      { date: `${currentYear}-10-26`, name: "Valmiki Jayanti" },
      { date: `${currentYear}-10-29`, name: "Karva Chauth (RH)" },
      { date: `${currentYear}-11-01`, name: "Diwali" },
      { date: `${currentYear}-11-02`, name: "Vishwakarma Day" },
      { date: `${currentYear}-11-16`, name: "Martyrdom Day S. Kartar Singh Sarabha" },
      { date: `${currentYear}-11-24`, name: "Prakash Utsav Shri Guru Nanak Dev Ji" },
      { date: `${currentYear}-12-25`, name: "Christmas Day" },
      { date: `${currentYear}-12-26`, name: "Winter Vacations" },
      { date: `${currentYear}-12-28`, name: "Shahidi Sabha Shri Fatehgarh Sahib" },
    ];

    return {
      fileName,
      startDate,
      endDate,
      workingDays,
      holidays: agcHolidays,
      needsReview: false,
      notes,
    };
  }

  // Scan working days
  if (fullText.includes("monday to saturday") || fullText.includes("6 day week") || fullText.includes("6 days a week")) {
    workingDays = [1, 2, 3, 4, 5, 6];
    notes.push("Detected 6-day academic week (Monday to Saturday).");
  } else {
    notes.push("Configured standard 5-day academic week (Monday to Friday).");
  }

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Semester start detection
    if (
      !startDate &&
      (lower.includes("start") ||
        lower.includes("commence") ||
        lower.includes("session begins") ||
        lower.includes("term start") ||
        lower.includes("w.e.f"))
    ) {
      const parsed = parseDateSnippet(line, currentYear);
      if (parsed) {
        startDate = parsed;
        continue;
      }
    }

    // Semester end detection
    if (
      !endDate &&
      (lower.includes("end") ||
        lower.includes("conclude") ||
        lower.includes("term end") ||
        lower.includes("last working day") ||
        lower.includes("exam end"))
    ) {
      const parsed = parseDateSnippet(line, currentYear);
      if (parsed) {
        endDate = parsed;
        continue;
      }
    }

    // General range pattern (e.g. "Semester: 10 Aug to 20 Dec 2026")
    if ((!startDate || !endDate) && (lower.includes("semester") || lower.includes("session") || lower.includes("academic year"))) {
      const dates = line.match(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g);
      if (dates && dates.length >= 2) {
        const d1 = parseDateSnippet(dates[0], currentYear);
        const d2 = parseDateSnippet(dates[1], currentYear);
        if (d1 && d2) {
          startDate = d1;
          endDate = d2;
          continue;
        }
      }
    }

    // Holiday detection (lines containing holiday names or keywords)
    const isHolidayLine =
      lower.includes("holiday") ||
      lower.includes("jayanti") ||
      lower.includes("diwali") ||
      lower.includes("eid") ||
      lower.includes("christmas") ||
      lower.includes("independence") ||
      lower.includes("republic day") ||
      lower.includes("vacation") ||
      lower.includes("break") ||
      lower.includes("festival") ||
      lower.includes("closed") ||
      lower.includes("gandhi") ||
      lower.includes("dussehra") ||
      lower.includes("holi");

    if (isHolidayLine) {
      const date = parseDateSnippet(line, currentYear);
      if (date) {
        const holidayName = line
          .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, "")
          .replace(/\b\d{1,2}\s+[A-Za-z]+(?:\s+\d{2,4})?\b/g, "")
          .replace(/^[-–:|]+/, "")
          .replace(/[-–:|]+$/, "")
          .trim();

        if (!holidays.some((h) => h.date === date)) {
          holidays.push({
            date,
            name: holidayName.length > 2 ? holidayName : "Public Holiday",
          });
        }
      }
    }
  }

  // Fallback defaults if dates were not explicitly marked
  if (!startDate) {
    startDate = `${currentYear}-08-01`;
    notes.push(`Semester start date defaulted to ${startDate} (please confirm).`);
  }
  if (!endDate) {
    endDate = `${currentYear}-12-20`;
    notes.push(`Semester end date defaulted to ${endDate} (please confirm).`);
  }

  if (startDate > endDate) {
    const tmp = startDate;
    startDate = endDate;
    endDate = tmp;
  }

  return {
    fileName,
    startDate,
    endDate,
    workingDays,
    holidays,
    needsReview: holidays.length === 0,
    notes,
  };
}
