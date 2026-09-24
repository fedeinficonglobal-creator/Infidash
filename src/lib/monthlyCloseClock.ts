const madridDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
});

function madridDateParts(instant: Date) {
  const parts = Object.fromEntries(madridDateFormatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function nextMonthKey(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) throw new Error('Mes inválido');
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);
}

function previousMonthKey(year: number, month: number) {
  return month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
}

export function dueMonthlyKpiMonth(now = new Date()) {
  const { year, month, day } = madridDateParts(now);
  return day >= 25 ? monthKey(year, month) : previousMonthKey(year, month);
}

export function nextMadridCloseInstant(now = new Date()) {
  const local = madridDateParts(now);
  const target = local.day < 25 ? monthKey(local.year, local.month) : nextMonthKey(monthKey(local.year, local.month));
  const [year, month] = target.split('-').map(Number);
  const targetDate = `${target}-25`;
  let low = Date.UTC(year, month - 1, 24, 20);
  let high = Date.UTC(year, month - 1, 25, 2);
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const parts = madridDateParts(new Date(middle));
    const localDate = `${monthKey(parts.year, parts.month)}-${String(parts.day).padStart(2, '0')}`;
    if (localDate >= targetDate) high = middle;
    else low = middle + 1;
  }
  return new Date(low);
}
