import crypto from "crypto";

/**
 * In-memory sliding window rate limiter and content hash cache
 * for academic document uploads (timetables & calendars).
 *
 * Protects Gemini API quota from:
 * 1. Rapid clickers / spamming / abuse
 * 2. Simultaneous orientation burst exceeding 15 RPM
 * 3. Redundant re-uploads of the exact same document
 */

interface RateLimitRecord {
  timestamps: number[];
}

interface CacheRecord<T = unknown> {
  data: T;
  timestamp: number;
}

// In-memory sliding window stores (keyed by studentId and ip)
const userBurstWindow = new Map<string, RateLimitRecord>();
const userDailyWindow = new Map<string, RateLimitRecord>();
const ipBurstWindow = new Map<string, RateLimitRecord>();

// Content hash cache: hash:docType -> CacheRecord
const contentCache = new Map<string, CacheRecord>();
const MAX_CACHE_ENTRIES = 150;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Limits
const USER_BURST_LIMIT = 5; // max 5 uploads
const USER_BURST_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes

const USER_DAILY_LIMIT = 25; // max 25 uploads
const USER_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000; // per 24 hours

const IP_BURST_LIMIT = 10; // max 10 uploads
const IP_BURST_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes

function pruneTimestamps(record: RateLimitRecord, windowMs: number, now: number) {
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);
}

/**
 * Checks whether an upload request is allowed under student & IP rate limits.
 */
export function checkPlannerRateLimit(
  studentId: string,
  ip?: string | null
): { allowed: boolean; retryAfterSeconds?: number; reason?: string } {
  const now = Date.now();

  // 1. User Burst Limit (5 per 10 min)
  let userBurst = userBurstWindow.get(studentId);
  if (!userBurst) {
    userBurst = { timestamps: [] };
    userBurstWindow.set(studentId, userBurst);
  }
  pruneTimestamps(userBurst, USER_BURST_WINDOW_MS, now);

  if (userBurst.timestamps.length >= USER_BURST_LIMIT) {
    const oldest = userBurst.timestamps[0];
    const waitSec = Math.ceil((USER_BURST_WINDOW_MS - (now - oldest)) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, waitSec),
      reason: `You have uploaded ${USER_BURST_LIMIT} documents recently. Please wait ${waitSec}s before uploading again.`,
    };
  }

  // 2. User Daily Limit (25 per 24 hours)
  let userDaily = userDailyWindow.get(studentId);
  if (!userDaily) {
    userDaily = { timestamps: [] };
    userDailyWindow.set(studentId, userDaily);
  }
  pruneTimestamps(userDaily, USER_DAILY_WINDOW_MS, now);

  if (userDaily.timestamps.length >= USER_DAILY_LIMIT) {
    const oldest = userDaily.timestamps[0];
    const waitHours = Math.ceil((USER_DAILY_WINDOW_MS - (now - oldest)) / (60 * 60 * 1000));
    return {
      allowed: false,
      retryAfterSeconds: waitHours * 3600,
      reason: `Daily upload limit reached (${USER_DAILY_LIMIT} per day). Please try again later.`,
    };
  }

  // 3. IP Burst Limit (10 per 10 min)
  if (ip && ip !== "127.0.0.1" && ip !== "::1") {
    let ipRecord = ipBurstWindow.get(ip);
    if (!ipRecord) {
      ipRecord = { timestamps: [] };
      ipBurstWindow.set(ip, ipRecord);
    }
    pruneTimestamps(ipRecord, IP_BURST_WINDOW_MS, now);

    if (ipRecord.timestamps.length >= IP_BURST_LIMIT) {
      const oldest = ipRecord.timestamps[0];
      const waitSec = Math.ceil((IP_BURST_WINDOW_MS - (now - oldest)) / 1000);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, waitSec),
        reason: `Network rate limit reached from your connection. Please wait ${waitSec}s.`,
      };
    }
    ipRecord.timestamps.push(now);
  }

  // Record valid attempt
  userBurst.timestamps.push(now);
  userDaily.timestamps.push(now);

  return { allowed: true };
}

/**
 * Computes SHA-256 checksum for document deduplication
 */
export function computeDocumentHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Retrieves cached AI extraction result if previously parsed
 */
export function getCachedPlannerResult<T>(hash: string, docType: string): T | null {
  const key = `${docType}:${hash}`;
  const record = contentCache.get(key);
  if (!record) return null;

  if (Date.now() - record.timestamp > CACHE_TTL_MS) {
    contentCache.delete(key);
    return null;
  }

  return record.data as T;
}

/**
 * Saves AI extraction result to memory cache with LRU eviction
 */
export function setCachedPlannerResult<T>(hash: string, docType: string, data: T): void {
  const key = `${docType}:${hash}`;

  if (contentCache.size >= MAX_CACHE_ENTRIES) {
    // Delete oldest entry
    const oldestKey = contentCache.keys().next().value;
    if (oldestKey) contentCache.delete(oldestKey);
  }

  contentCache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Test utility to reset rate limiters and cache in unit tests
 */
export function __resetPlannerRateLimiter(): void {
  userBurstWindow.clear();
  userDailyWindow.clear();
  ipBurstWindow.clear();
  contentCache.clear();
}
