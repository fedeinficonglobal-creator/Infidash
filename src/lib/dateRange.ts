export function isValidInclusiveDateRange(from: string, to: string, maxDays: number) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(value)) return null;
    const time = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
    return time;
  };
  const start = parse(from);
  const end = parse(to);
  if (start === null || end === null || end < start || !Number.isInteger(maxDays) || maxDays < 1) return false;
  return (end - start) / 86_400_000 < maxDays;
}
