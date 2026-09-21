import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";
import { extractDocumentContent, validateUploadedFile } from "@/lib/academic-document-extractor";
import {
  parseTimetableDocument,
  parseAcademicCalendarDocument,
  type ParsedTimetableEntry,
  type ParsedTimetableResult,
  type ParsedAcademicCalendarResult,
} from "@/lib/academic-document-parser";
import { matchTimetableSubject } from "@/lib/academic-planner";
import {
  checkPlannerRateLimit,
  computeDocumentHash,
  getCachedPlannerResult,
  setCachedPlannerResult,
} from "@/lib/planner-rate-limiter";
import {
  isGeminiConfigured,
  extractTimetableWithGemini,
  extractCalendarWithGemini,
} from "@/lib/gemini-ai";

// Allow up to 30 seconds for AI & OCR extraction
export const maxDuration = 30;

const DAY_NUM_MAP: Record<string, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

const DAY_NAME_MAP: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export async function POST(req: NextRequest) {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 1. Sliding window rate limiting per student & client IP
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  const rateCheck = checkPlannerRateLimit(student.id, clientIp);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: rateCheck.reason || "Rate limit exceeded. Please wait a moment." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateCheck.retryAfterSeconds || 60),
        },
      }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Failed to process multipart upload." },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;
  const docType = ((formData.get("type") as string) || "").trim().toLowerCase();

  if (!file) {
    return NextResponse.json(
      { error: "No document provided. Please choose a file to upload." },
      { status: 400 }
    );
  }

  if (docType !== "timetable" && docType !== "calendar") {
    return NextResponse.json(
      { error: "Invalid document type. Expected 'timetable' or 'calendar'." },
      { status: 400 }
    );
  }

  // 2. File size & format validation (max 10MB, PDF/JPG/PNG/WEBP/DOC/DOCX)
  const validation = validateUploadedFile(file.name, file.size);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || "Unsupported file format." },
      { status: 400 }
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Document Content Hash Check (Zero-cost duplicate caching)
    const docHash = computeDocumentHash(buffer);
    const cached = getCachedPlannerResult(docHash, docType);
    if (cached) {
      return NextResponse.json({
        ok: true,
        type: docType,
        fileName: file.name,
        extractedVia: "gemini-ai-cached",
        result: cached,
      });
    }

    // 4. Check if Gemini multimodal AI is available
    const geminiActive = isGeminiConfigured();

    // ==========================================
    // 5. TIMETABLE WORKFLOW
    // ==========================================
    if (docType === "timetable") {
      const studentSubjects = await db.subjectAttendance.findMany({
        where: { studentId: student.id },
        select: { subjectCode: true, subjectName: true },
      });

      // Try Gemini AI first if configured
      if (geminiActive) {
        try {
          const aiResponse = await extractTimetableWithGemini(
            buffer,
            file.type,
            file.name,
            student.section || undefined,
            studentSubjects
          );

          if (aiResponse.ok && aiResponse.result) {
            const res = aiResponse.result;

            // Strict Timetable Validation Check: Reject if NOT an academic timetable
            if (res.isTimetable === false) {
              return NextResponse.json(
                {
                  error:
                    res.rejectionReason ||
                    "The uploaded file does not appear to be an academic class timetable. Please upload an official weekly schedule.",
                },
                { status: 422 }
              );
            }

            // Map extracted classes to AttendFlow structure
            if (Array.isArray(res.classes) && res.classes.length > 0) {
              const mappedEntries: ParsedTimetableEntry[] = res.classes.map(
                (cls, idx) => {
                  const dayNum =
                    DAY_NUM_MAP[(cls.dayOfWeek || "").toUpperCase()] || 1;
                  const dayName = DAY_NAME_MAP[dayNum] || "Monday";
                  const match = matchTimetableSubject(
                    cls.subjectName,
                    studentSubjects
                  );

                  return {
                    id: `gemini-${idx}-${Date.now()}`,
                    dayOfWeek: dayNum,
                    dayName,
                    startTime: cls.startTime,
                    endTime: cls.endTime,
                    subjectName: cls.subjectName,
                    subjectCode:
                      cls.subjectCode || match.matchedCode || `SUBJ-${dayNum}-${idx}`,
                    room: cls.room || undefined,
                    teacher: cls.teacher || undefined,
                    matchedSubjectCode: match.matchedCode,
                    matchedSubjectName: match.matchedCode
                      ? studentSubjects.find(
                          (s) => s.subjectCode === match.matchedCode
                        )?.subjectName
                      : undefined,
                    matchConfidence:
                      match.confidence === "exact"
                        ? "high"
                        : match.confidence === "normalized"
                        ? "medium"
                        : "none",
                    needsReview: match.confidence === "none",
                    classType: cls.type || "THEORY",
                  };
                }
              );

              // Sort entries by day and time
              mappedEntries.sort((a, b) => {
                if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
                return a.startTime.localeCompare(b.startTime);
              });

              const daysWithClasses = Array.from(
                new Set(mappedEntries.map((e) => e.dayName))
              );
              const uniqueSubjects = new Set(
                mappedEntries.map((e) => e.subjectCode)
              ).size;
              const needsReviewCount = mappedEntries.filter(
                (e) => e.needsReview
              ).length;

              // Convert Gemini's string offDays (e.g. ["MONDAY"]) to day numbers.
              // These are the timetable-specific section/department weekly off-days.
              const detectedOffDayNums = Array.from(
                new Set(
                  (res.offDays || []).map((d) => DAY_NUM_MAP[(d || "").toUpperCase()] || 0).filter((n) => n >= 1)
                )
              ).sort() as number[];

              const parsedTimetableResult: ParsedTimetableResult = {
                fileName: file.name,
                entries: mappedEntries,
                offDays: detectedOffDayNums,
                summary: {
                  totalClassesDetected: mappedEntries.length,
                  daysWithClasses,
                  uniqueSubjectsCount: uniqueSubjects,
                  needsReviewCount,
                },
              };

              // Cache result for 0ms future duplicate uploads
              setCachedPlannerResult(docHash, "timetable", parsedTimetableResult);

              return NextResponse.json({
                ok: true,
                type: "timetable",
                fileName: file.name,
                extractedVia: "gemini-ai",
                result: parsedTimetableResult,
              });
            }
          }
        } catch (aiErr) {
          console.warn(
            "[api/planner/upload] Gemini AI extraction failed, falling back to local OCR:",
            aiErr
          );
        }
      }

      // If Gemini is not configured and user uploaded an image on Vercel
      if (!geminiActive && (file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name))) {
        if (process.env.VERCEL) {
          return NextResponse.json(
            {
              error:
                "Gemini AI is not yet configured on this deployment. Please add GEMINI_API_KEY in your Vercel Project Settings (Settings -> Environment Variables -> GEMINI_API_KEY), or upload your timetable in PDF format.",
            },
            { status: 422 }
          );
        }
      }

      // Offline / Fallback Extraction using Local Tesseract + Regex Parser
      const extracted = await extractDocumentContent(buffer, file.name, file.type);
      if (!extracted.rawText || extracted.rawText.trim().length < 5) {
        return NextResponse.json(
          {
            error:
              "We couldn't detect readable text in this document. Please ensure it is not an empty or password-protected file, or try uploading a clearer image/PDF.",
          },
          { status: 422 }
        );
      }

      let parsedTimetable: ParsedTimetableResult;
      try {
        parsedTimetable = parseTimetableDocument(
          extracted.rawText,
          file.name,
          studentSubjects,
          student.section || undefined
        );
      } catch (valErr) {
        return NextResponse.json(
          {
            error:
              valErr instanceof Error
                ? valErr.message
                : "The uploaded file does not appear to be a class timetable. Please upload an official weekly schedule.",
          },
          { status: 422 }
        );
      }

      if (parsedTimetable.entries.length === 0) {
        return NextResponse.json(
          {
            error:
              "We couldn't detect any scheduled class times in this timetable document. Please upload a clearer PDF, Word, or image schedule.",
            rawSnippet: extracted.rawText.slice(0, 300),
          },
          { status: 422 }
        );
      }

      setCachedPlannerResult(docHash, "timetable", parsedTimetable);

      return NextResponse.json({
        ok: true,
        type: "timetable",
        fileName: file.name,
        extractedVia: extracted.extractedVia,
        result: parsedTimetable,
      });
    }

    // ==========================================
    // 6. ACADEMIC CALENDAR WORKFLOW
    // ==========================================
    if (docType === "calendar") {
      // Try Gemini AI first if configured
      if (geminiActive) {
        try {
          const aiResponse = await extractCalendarWithGemini(
            buffer,
            file.type,
            file.name
          );

          if (aiResponse.ok && aiResponse.result) {
            const res = aiResponse.result;

            // Strict Academic Calendar Validation Check
            if (res.isAcademicCalendar === false) {
              return NextResponse.json(
                {
                  error:
                    res.rejectionReason ||
                    "The uploaded file does not appear to be an academic calendar. Please upload an official calendar or semester schedule.",
                },
                { status: 422 }
              );
            }

            const holidays = (res.holidays || []).map((h) => ({
              date: h.date,
              name: h.name,
            }));

            // Deduplicate holidays by date
            const uniqueHolidays = Array.from(
              new Map(holidays.map((h) => [h.date, h])).values()
            );

            const parsedCalendarResult: ParsedAcademicCalendarResult = {
              fileName: file.name,
              startDate: res.semesterStartDate || "2026-07-15",
              endDate: res.semesterEndDate || "2026-12-24",
              workingDays:
                Array.isArray(res.workingDays) && res.workingDays.length > 0
                  ? res.workingDays
                  : [1, 2, 3, 4, 5],
              holidays: uniqueHolidays,
              needsReview: uniqueHolidays.length === 0,
              notes: [
                res.academicYear ? `Academic Year: ${res.academicYear}` : "",
                res.semester ? `Semester: ${res.semester}` : "",
              ].filter(Boolean),
            };

            setCachedPlannerResult(docHash, "calendar", parsedCalendarResult);

            return NextResponse.json({
              ok: true,
              type: "calendar",
              fileName: file.name,
              extractedVia: "gemini-ai",
              result: parsedCalendarResult,
            });
          }
        } catch (aiErr) {
          console.warn(
            "[api/planner/upload] Gemini AI calendar extraction failed, falling back to local OCR:",
            aiErr
          );
        }
      }

      // If Gemini is not configured and user uploaded an image on Vercel
      if (!geminiActive && (file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name))) {
        if (process.env.VERCEL) {
          return NextResponse.json(
            {
              error:
                "Gemini AI is not yet configured on this deployment. Please add GEMINI_API_KEY in your Vercel Project Settings (Settings -> Environment Variables -> GEMINI_API_KEY), or upload your calendar in PDF format.",
            },
            { status: 422 }
          );
        }
      }

      // Offline / Fallback Extraction using Local Parser
      const extracted = await extractDocumentContent(buffer, file.name, file.type);
      if (!extracted.rawText || extracted.rawText.trim().length < 5) {
        return NextResponse.json(
          {
            error:
              "We couldn't detect readable text in this document. Please upload a clearer PDF or image.",
          },
          { status: 422 }
        );
      }

      let parsedCalendar: ParsedAcademicCalendarResult;
      try {
        parsedCalendar = parseAcademicCalendarDocument(
          extracted.rawText,
          file.name
        );
      } catch (valErr) {
        return NextResponse.json(
          {
            error:
              valErr instanceof Error
                ? valErr.message
                : "The uploaded file does not appear to be an academic calendar. Please upload an official calendar document.",
          },
          { status: 422 }
        );
      }

      setCachedPlannerResult(docHash, "calendar", parsedCalendar);

      return NextResponse.json({
        ok: true,
        type: "calendar",
        fileName: file.name,
        extractedVia: extracted.extractedVia,
        result: parsedCalendar,
      });
    }

    return NextResponse.json({ error: "Unhandled document type" }, { status: 400 });
  } catch (err) {
    console.error("[api/planner/upload] Extraction error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while processing the document. Please try again.",
      },
      { status: 500 }
    );
  }
}
