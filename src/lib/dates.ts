/**
 * Device-local calendar dates. Never use UTC via toISOString().split("T")[0],
 * which jumps a day after 09:00 JST (UTC midnight).
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split("-");
  if (parts.length !== 3) {
    return new Date(NaN);
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return new Date(year, month, day);
}

export function formatLocalDate(date: Date): string {
  return getLocalDateString(date);
}

export function addDays(dateStr: string, days: number): string {
  const date = parseLocalDate(dateStr);
  if (Number.isNaN(date.getTime())) {
    return getLocalDateString();
  }
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

export function newTaskId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
