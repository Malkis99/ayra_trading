/**
 * Date and timezone helper utilities for AYRA Journal & Game state
 */

export function getLocalDateString(date: Date = new Date(), timezone?: string): string {
  try {
    const tz = timezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date); // Returns YYYY-MM-DD
  } catch (e) {
    // Fallback to local system time formatting YYYY-MM-DD
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

export function getMondayLocalDateString(date: Date = new Date(), timezone?: string): string {
  const localDateStr = getLocalDateString(date, timezone);
  const [y, m, d] = localDateStr.split("-").map(Number);
  // Create Date object representing local midnight
  const targetDate = new Date(y, m - 1, d);
  const day = targetDate.getDay();
  // Sunday is 0, Monday is 1, Saturday is 6
  const diff = targetDate.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(targetDate.setDate(diff));

  const my = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  const md = String(monday.getDate()).padStart(2, "0");
  return `${my}-${mm}-${md}`;
}
