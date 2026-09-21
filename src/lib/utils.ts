import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats 24-hour time (e.g. "09:00", "13:10", "14:00") into 12-hour AM/PM format (e.g. "9:00 AM", "1:10 PM", "2:00 PM").
 * Strictly for user-facing display. Does not alter underlying database or calculation values.
 */
export function formatTime12Hour(timeStr: string | null | undefined): string {
  if (!timeStr) return "";
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?$/i);
  if (!match) return trimmed;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const existingAmpm = match[3]?.toUpperCase();

  if (existingAmpm) {
    return `${hours}:${minutes} ${existingAmpm}`;
  }

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${hours}:${minutes} ${ampm}`;
}
