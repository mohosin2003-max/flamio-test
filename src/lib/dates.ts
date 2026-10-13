export function dhakaDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dhakaDayBounds(dateKey: string): { from: string; to: string } {
  const start = new Date(`${dateKey}T00:00:00+06:00`);
  const end = new Date(start.getTime() + 86_400_000 - 1);
  return { from: start.toISOString(), to: end.toISOString() };
}