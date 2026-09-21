import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";
import { extractDocumentContent, validateUploadedFile } from "@/lib/academic-document-extractor";
import { parseTimetableDocument, parseAcademicCalendarDocument } from "@/lib/academic-document-parser";

// Allow up to 30 seconds for serverless OCR extraction
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to process multipart upload." },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;
  const docType = (formData.get("type") as string || "").trim().toLowerCase();

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

  // File size & format validation
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

    // 1. Extract raw text / structural blocks
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

    // 2. Parse Timetable
    if (docType === "timetable") {
      const studentSubjects = await db.subjectAttendance.findMany({
        where: { studentId: student.id },
        select: { subjectCode: true, subjectName: true },
      });

      let parsedTimetable;
      try {
        parsedTimetable = parseTimetableDocument(
          extracted.rawText,
          file.name,
          studentSubjects
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

      return NextResponse.json({
        ok: true,
        type: "timetable",
        fileName: file.name,
        extractedVia: extracted.extractedVia,
        result: parsedTimetable,
      });
    }

    // 3. Parse Academic Calendar
    if (docType === "calendar") {
      let parsedCalendar;
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
            : "An unexpected error occurred while reading the document. Please try a different file format.",
      },
      { status: 500 }
    );
  }
}
