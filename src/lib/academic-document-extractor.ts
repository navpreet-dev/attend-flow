/**
 * Academic Document Extractor
 *
 * Extracts text and structural information from uploaded files:
 * - PDF (via pdf-parse)
 * - DOCX (via mammoth)
 * - DOC (plain text string decoding)
 * - Images: JPG, JPEG, PNG (via tesseract.js OCR, plus optional Gemini Vision)
 */

import path from "path";

export interface ExtractedDocumentContent {
  fileName: string;
  fileType: "pdf" | "docx" | "doc" | "image";
  mimeType: string;
  rawText: string;
  charCount: number;
  extractedVia: "pdf-parse" | "mammoth" | "doc-decoder" | "tesseract" | "gemini-vision";
}

const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateUploadedFile(fileName: string, fileSize: number): {
  valid: boolean;
  error?: string;
  fileType?: "pdf" | "docx" | "doc" | "image";
} {
  if (fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File is too large (${(fileSize / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 10 MB.`,
    };
  }

  const ext = path.extname(fileName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file format '${ext}'. Please upload PDF, JPG, JPEG, PNG, DOC, or DOCX.`,
    };
  }

  let fileType: "pdf" | "docx" | "doc" | "image" = "pdf";
  if (ext === ".pdf") fileType = "pdf";
  else if (ext === ".docx") fileType = "docx";
  else if (ext === ".doc") fileType = "doc";
  else if ([".jpg", ".jpeg", ".png"].includes(ext)) fileType = "image";

  return { valid: true, fileType };
}

/**
 * Extract readable text from binary .doc files (Word 97-2003)
 */
function extractTextFromBinaryDoc(buffer: Buffer): string {
  // Extract sequences of 3 or more printable ASCII / UTF-8 characters
  const str = buffer.toString("binary");
  const matches = str.match(/[\x20-\x7E\t\r\n]{3,}/g) || [];
  return matches
    .filter((chunk) => chunk.trim().length > 3)
    .join("\n")
    .replace(/[^\x20-\x7E\t\r\n]/g, " ")
    .trim();
}

/**
 * Main extractor dispatch function
 */
export async function extractDocumentContent(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<ExtractedDocumentContent> {
  const validation = validateUploadedFile(fileName, buffer.length);
  if (!validation.valid || !validation.fileType) {
    throw new Error(validation.error || "Invalid file format");
  }

  const fileType = validation.fileType;

  // 1. PDF
  if (fileType === "pdf") {
    try {
      // Dynamic require so Next.js build or edge handles it cleanly
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      const text = (data.text || "").trim();

      if (text.length >= 20) {
        return {
          fileName,
          fileType: "pdf",
          mimeType: mimeType || "application/pdf",
          rawText: text,
          charCount: text.length,
          extractedVia: "pdf-parse",
        };
      }
      // If PDF text is extremely short (e.g., scanned PDF image),
      // we note that text was limited and return what was available
      return {
        fileName,
        fileType: "pdf",
        mimeType: mimeType || "application/pdf",
        rawText: text,
        charCount: text.length,
        extractedVia: "pdf-parse",
      };
    } catch (err) {
      throw new Error(
        `Failed to parse PDF document: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 2. DOCX
  if (fileType === "docx") {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const text = (result.value || "").trim();
      return {
        fileName,
        fileType: "docx",
        mimeType: mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        rawText: text,
        charCount: text.length,
        extractedVia: "mammoth",
      };
    } catch (err) {
      throw new Error(
        `Failed to parse DOCX document: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 3. DOC (legacy binary format)
  if (fileType === "doc") {
    try {
      const text = extractTextFromBinaryDoc(buffer);
      return {
        fileName,
        fileType: "doc",
        mimeType: mimeType || "application/msword",
        rawText: text,
        charCount: text.length,
        extractedVia: "doc-decoder",
      };
    } catch (err) {
      throw new Error(
        `Failed to parse DOC document: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 4. Images (JPG, JPEG, PNG)
  if (fileType === "image") {
    // Check if optional Gemini API key is available for vision extraction
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const base64Data = buffer.toString("base64");
        const imageMime = mimeType || (fileName.endsWith(".png") ? "image/png" : "image/jpeg");
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: "Transcribe all text from this academic timetable or calendar image accurately, preserving table structure, days of week, times, subjects, and dates line by line.",
                    },
                    {
                      inlineData: {
                        mimeType: imageMime,
                        data: base64Data,
                      },
                    },
                  ],
                },
              ],
            }),
          }
        );

        if (response.ok) {
          const json = await response.json();
          const aiText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (aiText && aiText.trim().length > 10) {
            return {
              fileName,
              fileType: "image",
              mimeType: imageMime,
              rawText: aiText.trim(),
              charCount: aiText.trim().length,
              extractedVia: "gemini-vision",
            };
          }
        }
      } catch {
        // Fallback to local tesseract OCR
      }
    }

    // Built-in offline OCR using Tesseract.js
    try {
      const { createWorker } = require("tesseract.js");
      const worker = await createWorker("eng");
      const ret = await worker.recognize(buffer);
      await worker.terminate();

      const ocrText = (ret?.data?.text || "").trim();
      return {
        fileName,
        fileType: "image",
        mimeType: mimeType || (fileName.endsWith(".png") ? "image/png" : "image/jpeg"),
        rawText: ocrText,
        charCount: ocrText.length,
        extractedVia: "tesseract",
      };
    } catch (err) {
      throw new Error(
        `Failed to recognize text in image: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}
