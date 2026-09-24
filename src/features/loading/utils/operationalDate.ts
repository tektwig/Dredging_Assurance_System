const LAGOS_ZONE = 'Africa/Lagos';

export function operationalDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function operationalDateLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: LAGOS_ZONE, day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);
}

// Display/prevalidation only. public.normalize_plate and lookup_loading_truck remain authoritative.
export function platePreview(value: string): string {
  return value.replace(/[\t\n\v\f\r -]+/g, '').toUpperCase();
}
