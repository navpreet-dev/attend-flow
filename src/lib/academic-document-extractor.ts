/**
 * Academic Document Extractor
 *
 * Extracts text and structural information from uploaded files:
 * - PDF (via pdf-parse)
 * - DOCX (via mammoth)
 * - DOC (plain text string decoding)
 * - Images: JPG, JPEG, PNG (via sharp optimization + tesseract.js OCR, plus optional Gemini Vision)
 */

import path from "path";

// 1. Polyfill DOMMatrix for any PDF parsers running in Next.js / Node.js
if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    constructor(_init?: any) {}
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
    rotate() { return this; }
    inverse() { return this; }
    transformPoint(point: any) { return point; }
  };
}

export interface ExtractedDocumentContent {
  fileName: string;
  fileType: "pdf" | "docx" | "doc" | "image";
  mimeType: string;
  rawText: string;
  charCount: number;
  extractedVia: "pdf-parse" | "mammoth" | "doc-decoder" | "tesseract" | "gemini-vision";
}

const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png", ".webp"];
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
      error: `Unsupported file format '${ext}'. Please upload PDF, JPG, JPEG, PNG, WEBP, DOC, or DOCX.`,
    };
  }

  let fileType: "pdf" | "docx" | "doc" | "image" = "pdf";
  if (ext === ".pdf") fileType = "pdf";
  else if (ext === ".docx") fileType = "docx";
  else if (ext === ".doc") fileType = "doc";
  else if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) fileType = "image";

  return { valid: true, fileType };
}

/**
 * Extract readable text from binary .doc files (Word 97-2003)
 */
function extractTextFromBinaryDoc(buffer: Buffer): string {
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
      let pdfParse: any;
      try {
        pdfParse = require("pdf-parse/lib/pdf-parse.js");
      } catch {
        pdfParse = require("pdf-parse");
      }
      const data = await pdfParse(buffer);
      const text = (data.text || "").trim();

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
        
        // Use gemini-3.1-flash-lite (primary) with gemini-3.6-flash fallback
        let apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`;
        let response = await fetch(apiUrl, {
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
        });

        if (!response.ok && (response.status === 503 || response.status === 404)) {
          apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
          response = await fetch(apiUrl, {
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
          });
        }

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

    // Built-in offline OCR using sharp optimization + Tesseract.js
    try {
      let ocrBuffer = buffer;

      // Optimize image with sharp: resize to max 850px, grayscale, normalize contrast
      // This reduces OCR computation time by ~60% (typically 3-5 seconds) while keeping text crisp.
      try {
        const sharp = require("sharp");
        ocrBuffer = await sharp(buffer)
          .resize({ width: 850, height: 850, fit: "inside", withoutEnlargement: true })
          .grayscale()
          .normalize()
          .toBuffer();
      } catch {
        // Use original buffer if sharp optimization fails
      }

      const { createWorker } = require("tesseract.js");
      const fs = require("fs");
      const isServerless = Boolean(
        process.env.VERCEL ||
        process.env.AWS_LAMBDA_FUNCTION_NAME ||
        process.platform === "linux"
      );

      const workerOptions: Record<string, any> = {};
      if (isServerless) {
        workerOptions.cachePath = "/tmp";
        workerOptions.dataPath = "/tmp";
      }

      // Check for pre-bundled local traineddata to eliminate internet download delays on Vercel
      const localTessDir = path.join(process.cwd(), "public", "tessdata");
      const localTessGz = path.join(localTessDir, "eng.traineddata.gz");

      if (fs.existsSync(localTessGz)) {
        if (isServerless) {
          const tmpGz = path.join("/tmp", "eng.traineddata.gz");
          if (!fs.existsSync(tmpGz)) {
            try {
              fs.copyFileSync(localTessGz, tmpGz);
            } catch {
              // Ignore copy error
            }
          }
          workerOptions.langPath = "/tmp";
        } else {
          workerOptions.langPath = localTessDir;
        }
        workerOptions.gzip = true;
      }

      try {
        const localWorkerPath = path.join(
          process.cwd(),
          "node_modules",
          "tesseract.js",
          "src",
          "worker-script",
          "node",
          "index.js"
        );
        if (fs.existsSync(localWorkerPath)) {
          workerOptions.workerPath = localWorkerPath;
        }
      } catch {
        // Fallback to default worker resolution if filesystem check fails
      }

      const worker = await createWorker("eng", 1, workerOptions);

      // Enforce timeout (8.5s serverless to stay inside Vercel's 10s ceiling, 15s local)
      const timeoutMs = isServerless ? 8500 : 15000;
      const ocrTimeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Image processing timed out. For instant processing on mobile, please upload in PDF format or provide a clear, cropped image."
              )
            ),
          timeoutMs
        )
      );

      let ocrText = "";
      try {
        const ret = await Promise.race([
          worker.recognize(ocrBuffer),
          ocrTimeout,
        ]);
        ocrText = (ret?.data?.text || "").trim();
      } finally {
        await worker.terminate().catch(() => {});
      }

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
