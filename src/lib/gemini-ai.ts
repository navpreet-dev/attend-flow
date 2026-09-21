/**
 * Server-side Gemini AI service for intelligent Timetable and Academic Calendar extraction.
 *
 * Models:
 * - Primary: gemini-3.1-flash-lite (high speed, structured JSON mode, multimodal image + PDF)
 * - Fallback: gemini-3.6-flash (if primary experiences 503 or transient downtime)
 *
 * Security:
 * - GEMINI_API_KEY is read strictly from process.env on the server.
 * - Key is never logged, exposed to the client, or returned in error bodies.
 */

export interface GeminiTimetableClass {
  dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
  startTime: string; // HH:MM in 24h
  endTime: string; // HH:MM in 24h
  subjectName: string;
  subjectCode: string | null;
  teacher: string | null;
  room: string | null;
  type: "THEORY" | "LABORATORY";
  batch: string | null;
}

export interface GeminiTimetableResult {
  isTimetable: boolean;
  confidence: number;
  rejectionReason: string | null;
  course: string | null;
  semester: string | null;
  section: string | null;
  offDays: string[];
  classes: GeminiTimetableClass[];
  notes?: string;
}

export interface GeminiHolidayItem {
  date: string; // YYYY-MM-DD
  name: string;
  type: "PUBLIC_HOLIDAY" | "COLLEGE_LEAVE" | "RESTRICTED";
}

export interface GeminiExamPeriod {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  name: string;
  type: "MID_TERM" | "FINAL_EXAM" | "PRACTICAL_EXAM";
}

export interface GeminiCalendarEvent {
  date: string; // YYYY-MM-DD
  name: string;
  category: "ACADEMIC" | "SPORTS" | "CULTURAL" | "OTHER";
}

export interface GeminiCalendarResult {
  isAcademicCalendar: boolean;
  confidence: number;
  rejectionReason: string | null;
  academicYear: string | null;
  semester: string | null;
  semesterStartDate: string | null; // YYYY-MM-DD
  semesterEndDate: string | null; // YYYY-MM-DD
  workingDays: number[]; // 1=Mon..7=Sun
  holidays: GeminiHolidayItem[];
  examinationDates: GeminiExamPeriod[];
  events: GeminiCalendarEvent[];
}

const PRIMARY_MODEL = "gemini-3.1-flash-lite";
const FALLBACK_MODEL = "gemini-3.6-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Checks if a Gemini API key is configured in server environment variables.
 */
export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10);
}

/**
 * Executes a Gemini generateContent call with model failover and JSON schema enforcement.
 */
async function callGeminiJson<T>(
  promptText: string,
  inlineData?: { mimeType: string; data: string },
  modelName: string = PRIMARY_MODEL
): Promise<{ ok: boolean; data?: T; status: number; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 401, error: "GEMINI_API_KEY is not configured" };
  }

  const url = `${API_BASE}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts: Array<Record<string, unknown>> = [{ text: promptText }];
  if (inlineData) {
    parts.push({
      inlineData: {
        mimeType: inlineData.mimeType,
        data: inlineData.data,
      },
    });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      // If 503 (High demand) or 404 on primary model, try fallback model once
      if ((res.status === 503 || res.status === 404) && modelName === PRIMARY_MODEL) {
        console.warn(`[gemini-ai] Primary model ${modelName} returned HTTP ${res.status}. Trying fallback ${FALLBACK_MODEL}...`);
        return callGeminiJson<T>(promptText, inlineData, FALLBACK_MODEL);
      }
      return { ok: false, status: res.status, error: `Gemini API error HTTP ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const json = await res.json();
    const candidateText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return { ok: false, status: 500, error: "Gemini returned empty candidate text" };
    }

    const parsedData = JSON.parse(candidateText) as T;
    return { ok: true, data: parsedData, status: 200 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (modelName === PRIMARY_MODEL) {
      console.warn(`[gemini-ai] Primary model failed with exception (${msg}). Trying fallback ${FALLBACK_MODEL}...`);
      return callGeminiJson<T>(promptText, inlineData, FALLBACK_MODEL);
    }
    return { ok: false, status: 500, error: `Gemini call failed: ${msg}` };
  }
}

/**
 * Extracts and validates an academic timetable using Gemini multimodal AI.
 */
export async function extractTimetableWithGemini(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  studentSection?: string,
  studentKnownSubjects?: Array<{ subjectCode: string; subjectName: string }>
): Promise<{ ok: boolean; result?: GeminiTimetableResult; error?: string; status?: number }> {
  const isDocOrText =
    mimeType.includes("word") ||
    mimeType.includes("officedocument") ||
    fileName.endsWith(".doc") ||
    fileName.endsWith(".docx");

  const prompt = `You are an expert university timetable analyzer and academic schedule detector.
Analyze the provided document (filename: "${fileName}", student registered section: "${studentSection || "unknown"}").

FIRST CRITICAL STEP — TIMETABLE DETECTION:
Determine whether this document is ACTUALLY an academic class schedule / weekly timetable.
- If it is NOT a timetable (e.g. it is a grocery store receipt, syllabus, resume, invoice, grade card, fee receipt, or random photo), set "isTimetable": false, provide a polite, clear "rejectionReason", and return an empty classes array.
- If it IS an academic timetable, set "isTimetable": true, and extract every class slot.

EXTRACTION INSTRUCTIONS:
1. Days of Week: Must be one of "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY".
2. Times: Must be 24-hour format "HH:MM" (e.g. "09:00", "09:50", "13:40"). Preserve original slot times accurately.
3. Class Types:
   - Identify whether each class is "THEORY" or "LABORATORY" (e.g., Computer Lab, Programming Lab, Physics Lab, Practical, or multi-hour lab blocks are "LABORATORY").
4. Details:
   - Extract subjectName, subjectCode (if written, e.g. BCA25302, AGC-18090), teacher/faculty name, and room/lab number.
5. Off-Days:
   - Detect which days are designated as OFF / No Classes for this section (e.g. if Section C has Tuesday off, or Section B has Monday off, or Saturday/Sunday off).
6. Batches/Sections:
   - If classes are split into batches (e.g. "G1" / "G2" or "B1" / "B2"), record the batch name.

Known subjects registered for this student (match against these when appropriate):
${studentKnownSubjects ? JSON.stringify(studentKnownSubjects) : "None provided"}

Output strictly valid JSON with no markdown wraps matching this structure:
{
  "isTimetable": true,
  "confidence": 0.95,
  "rejectionReason": null,
  "course": "BCA",
  "semester": "3rd",
  "section": "C",
  "offDays": ["TUESDAY", "SATURDAY", "SUNDAY"],
  "classes": [
    {
      "dayOfWeek": "MONDAY",
      "startTime": "09:00",
      "endTime": "09:50",
      "subjectName": "Computer Networks",
      "subjectCode": "BCA25301",
      "teacher": "Ms. Purba",
      "room": "EE-102",
      "type": "THEORY",
      "batch": null
    }
  ]
}`;

  const base64Data = buffer.toString("base64");
  const actualMime = isDocOrText ? "text/plain" : mimeType || "image/jpeg";

  const response = await callGeminiJson<GeminiTimetableResult>(
    prompt,
    { mimeType: actualMime, data: base64Data }
  );

  if (!response.ok || !response.data) {
    return { ok: false, error: response.error || "Failed to process timetable with Gemini AI", status: response.status };
  }

  return { ok: true, result: response.data, status: 200 };
}

/**
 * Extracts and validates an academic calendar using Gemini multimodal AI.
 */
export async function extractCalendarWithGemini(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ ok: boolean; result?: GeminiCalendarResult; error?: string; status?: number }> {
  const prompt = `You are an expert academic calendar analyzer and semester schedule detector.
Analyze the provided document (filename: "${fileName}").

FIRST CRITICAL STEP — ACADEMIC CALENDAR DETECTION:
Determine whether this document is ACTUALLY an academic calendar or institutional semester schedule.
- If it is NOT an academic calendar (e.g. it is a grocery receipt, syllabus, generic notice, class timetable, resume, or invoice), set "isAcademicCalendar": false, provide a polite, clear "rejectionReason", and return empty holidays/events.
- If it IS an academic calendar, set "isAcademicCalendar": true, and extract semester bounds, holidays, and exam dates.

EXTRACTION INSTRUCTIONS:
1. Semester Dates:
   - "semesterStartDate": YYYY-MM-DD (format strictly as YYYY-MM-DD, e.g. "2026-07-15")
   - "semesterEndDate": YYYY-MM-DD (e.g. "2026-12-24")
   - Do NOT guess or hallucinate. Use dates stated in the calendar.
2. Working Days:
   - Days of the week classes are held (e.g. [1, 2, 3, 4, 5] for Monday through Friday, or [1, 2, 3, 4, 5, 6] if Saturday is working).
3. Holidays:
   - Extract all listed public holidays, college vacations, and observances.
   - Strictly format date as "YYYY-MM-DD".
   - Set "type" to "PUBLIC_HOLIDAY", "COLLEGE_LEAVE", or "RESTRICTED".
4. Examination Dates:
   - Extract mid-semester (MST / mid-term), end-semester (final exams), and practical exams if listed.
   - "startDate" and "endDate" as YYYY-MM-DD.
5. Events & Deadlines:
   - Academic events, sports days, cultural fests, result declarations.

Output strictly valid JSON with no markdown wraps matching this structure:
{
  "isAcademicCalendar": true,
  "confidence": 0.95,
  "rejectionReason": null,
  "academicYear": "2026-2027",
  "semester": "Odd Semester (July-Dec 2026)",
  "semesterStartDate": "2026-07-15",
  "semesterEndDate": "2026-12-24",
  "workingDays": [1, 2, 3, 4, 5],
  "holidays": [
    {
      "date": "2026-08-15",
      "name": "Independence Day",
      "type": "PUBLIC_HOLIDAY"
    }
  ],
  "examinationDates": [
    {
      "startDate": "2026-10-12",
      "endDate": "2026-10-17",
      "name": "Mid Semester Tests (MST)",
      "type": "MID_TERM"
    }
  ],
  "events": []
}`;

  const base64Data = buffer.toString("base64");
  const actualMime = mimeType || (fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg");

  const response = await callGeminiJson<GeminiCalendarResult>(
    prompt,
    { mimeType: actualMime, data: base64Data }
  );

  if (!response.ok || !response.data) {
    return { ok: false, error: response.error || "Failed to process calendar with Gemini AI", status: response.status };
  }

  return { ok: true, result: response.data, status: 200 };
}
