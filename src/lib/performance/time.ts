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
