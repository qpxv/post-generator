export const POSTING_TIME_ZONE = 'Europe/Berlin';

// Month and hour as seen in the posting time zone, so "evening" and month
// buckets match when the posts actually went out
export function zonedParts(iso: string, timeZone = POSTING_TIME_ZONE): { month: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return { month: `${get('year')}-${get('month')}`, hour: Number(get('hour')) };
}

// Calendar date (YYYY-MM-DD) in the posting time zone, since journal days are Berlin days
export function zonedDate(date: Date, timeZone = POSTING_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "october 3", the same label the journal export uses for its filenames
export function dayLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`)
    .toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' })
    .toLowerCase();
}
