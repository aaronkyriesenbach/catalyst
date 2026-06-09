declare const cronBrand: unique symbol;

/** A validated 5-field cron expression. Only constructible via this module. */
export type CronExpression = string & { readonly [cronBrand]: true };

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export type Month =
  | "jan"
  | "feb"
  | "mar"
  | "apr"
  | "may"
  | "jun"
  | "jul"
  | "aug"
  | "sep"
  | "oct"
  | "nov"
  | "dec";

type Atom<T extends number | string> =
  | T
  | { every: number }
  | { range: [T, T]; step?: number };

type Field<T extends number | string> = "*" | Atom<T> | Atom<T>[];

export type CronParts = {
  minute?: Field<number>;
  hour?: Field<number>;
  dayOfMonth?: Field<number>;
  month?: Field<number | Month>;
  dayOfWeek?: Field<number | Weekday>;
};

const WEEKDAYS: Record<Weekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const MONTHS: Record<Month, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const resolveNumber = (value: number): number => value;
const resolveWeekday = (value: number | Weekday): number =>
  typeof value === "number" ? value : WEEKDAYS[value];
const resolveMonth = (value: number | Month): number =>
  typeof value === "number" ? value : MONTHS[value];

function renderAtom<T extends number | string>(
  atom: Atom<T>,
  resolve: (value: T) => number,
): string {
  if (typeof atom === "object") {
    if ("every" in atom) return `*/${atom.every}`;
    const [start, end] = atom.range;
    const base = `${resolve(start)}-${resolve(end)}`;
    return atom.step !== undefined ? `${base}/${atom.step}` : base;
  }
  return String(resolve(atom));
}

function renderField<T extends number | string>(
  field: Field<T>,
  resolve: (value: T) => number,
): string {
  if (field === "*") return "*";
  const atoms = Array.isArray(field) ? field : [field];
  return atoms.map((atom) => renderAtom(atom, resolve)).join(",");
}

/** Compose a cron expression from per-field values. Unset fields default to "*". */
export function cron(parts: CronParts): CronExpression {
  const fields = [
    renderField(parts.minute ?? "*", resolveNumber),
    renderField(parts.hour ?? "*", resolveNumber),
    renderField(parts.dayOfMonth ?? "*", resolveNumber),
    renderField(parts.month ?? "*", resolveMonth),
    renderField(parts.dayOfWeek ?? "*", resolveWeekday),
  ];
  return fields.join(" ") as CronExpression;
}

export const everyNMinutes = (n: number): CronExpression =>
  cron({ minute: { every: n } });

export const everyNHours = (n: number): CronExpression =>
  cron({ minute: 0, hour: { every: n } });

export const hourly = (minute = 0): CronExpression => cron({ minute });

export const dailyAt = (hour: number, minute = 0): CronExpression =>
  cron({ minute, hour });

export const weeklyOn = (
  day: number | Weekday,
  hour: number,
  minute = 0,
): CronExpression => cron({ minute, hour, dayOfWeek: day });

export const monthlyOn = (
  dayOfMonth: number,
  hour: number,
  minute = 0,
): CronExpression => cron({ minute, hour, dayOfMonth });

/** Escape hatch for raw cron strings. Validates field count only. */
export function rawCron(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expression}": expected 5 fields, got ${fields.length}`,
    );
  }
  return expression as CronExpression;
}
