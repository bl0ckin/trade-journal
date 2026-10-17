export interface Routine {
  id: string;
  title: string;
  stage: string;
  weekdays: number[];
  createdAt: string;
  archivedAt: string | null;
}
export interface RoutineCheck {
  ruleId: string;
  date: string;
  done: boolean;
}
export function scheduledRules(rules: Routine[], date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return rules.filter(
    (r) =>
      r.createdAt.slice(0, 10) <= date &&
      (!r.archivedAt || date < r.archivedAt.slice(0, 10)) &&
      r.weekdays.includes(weekday),
  );
}
export function progressScore(rules: Routine[], checks: RoutineCheck[], date: string) {
  const scheduled = scheduledRules(rules, date);
  const completed = scheduled.filter((r) =>
    checks.some((c) => c.ruleId === r.id && c.date === date && c.done),
  ).length;
  return {
    total: scheduled.length,
    completed,
    score: scheduled.length ? completed / scheduled.length : null,
  };
}

/* ------------------------------------------------------------------------------------------
 * Everything below is derived client-side from the same rules + checks the page already loads,
 * so it needs no database or API changes.
 * ---------------------------------------------------------------------------------------- */

export const STAGES = ["Before trading", "During trading", "After trading"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Suggested routines so a new journal never starts from a blank page. */
export const STARTER_ROUTINES: { title: string; stage: (typeof STAGES)[number] }[] = [
  { title: "Review the economic calendar and key levels", stage: "Before trading" },
  { title: "Write down today's plan and max risk", stage: "Before trading" },
  { title: "Check mindset: sleep, stress and focus", stage: "Before trading" },
  { title: "Only take setups from my playbook", stage: "During trading" },
  { title: "Stop at my daily loss limit", stage: "During trading" },
  { title: "Log every trade with a screenshot", stage: "After trading" },
  { title: "Review the day and rate my execution", stage: "After trading" },
];

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const doneSet = (checks: RoutineCheck[]) => {
  const set = new Set<string>();
  for (const c of checks) if (c.done) set.add(`${c.ruleId}:${c.date}`);
  return set;
};

export interface DayScore {
  date: string;
  total: number;
  completed: number;
  score: number | null;
}

/** Score for `count` consecutive days ending on `end` (inclusive), oldest first. */
export function dayScores(
  rules: Routine[],
  checks: RoutineCheck[],
  end: string,
  count: number,
): DayScore[] {
  const done = doneSet(checks);
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(end, i - (count - 1));
    const scheduled = scheduledRules(rules, date);
    const completed = scheduled.filter((r) => done.has(`${r.id}:${date}`)).length;
    return {
      date,
      total: scheduled.length,
      completed,
      score: scheduled.length ? completed / scheduled.length : null,
    };
  });
}

/**
 * Consecutive perfect days. Days with nothing scheduled neither extend nor break a streak, and an
 * unfinished `today` is given until the end of the day instead of resetting the count.
 */
export function perfectStreaks(rules: Routine[], checks: RoutineCheck[], today: string) {
  const firstDay = rules.reduce(
    (min, r) => (r.createdAt.slice(0, 10) < min ? r.createdAt.slice(0, 10) : min),
    today,
  );
  const span = Math.min(730, Math.max(1, daysBetween(firstDay, today) + 1));
  const days = dayScores(rules, checks, today, span);
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (d.score === null || (d.date === today && d.score < 1)) continue;
    if (d.score === 1) current++;
    else break;
  }
  let best = 0,
    run = 0;
  for (const d of days) {
    if (d.score === null || (d.date === today && d.score < 1)) continue;
    if (d.score === 1) best = Math.max(best, ++run);
    else run = 0;
  }
  return { current, best, perfectDays: days.filter((d) => d.score === 1).length };
}

export const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000,
  );

const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Average completion over the last `count` days that had something scheduled. */
export function rollingAverage(days: DayScore[], count: number) {
  return average(
    days
      .slice(-count)
      .filter((d) => d.score !== null)
      .map((d) => d.score!),
  );
}

export interface WeekScore {
  start: string;
  score: number | null;
  completed: number;
  total: number;
}

/** Completion per Sunday-start week for the last `weeks` weeks, oldest first. */
export function weeklyScores(
  rules: Routine[],
  checks: RoutineCheck[],
  today: string,
  weeks: number,
): WeekScore[] {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisWeek = addDays(today, -weekday);
  const first = addDays(thisWeek, -(weeks - 1) * 7);
  const days = dayScores(rules, checks, today, daysBetween(first, today) + 1);
  return Array.from({ length: weeks }, (_, w) => {
    const start = addDays(first, w * 7);
    const slice = days.filter((d) => d.date >= start && d.date < addDays(start, 7));
    const total = slice.reduce((s, d) => s + d.total, 0);
    const completed = slice.reduce((s, d) => s + d.completed, 0);
    return { start, total, completed, score: total ? completed / total : null };
  });
}

/** Completion rate by weekday over the last `count` days. */
export function weekdayScores(days: DayScore[]) {
  return WEEKDAY_SHORT.map((label, weekday) => {
    const slice = days.filter(
      (d) => d.total > 0 && new Date(`${d.date}T12:00:00Z`).getUTCDay() === weekday,
    );
    const total = slice.reduce((s, d) => s + d.total, 0);
    const completed = slice.reduce((s, d) => s + d.completed, 0);
    return { weekday, label, score: total ? completed / total : null, days: slice.length };
  });
}

export interface RoutineStat {
  rule: Routine;
  /** Completion rate over the window, or null when it was never scheduled. */
  rate: number | null;
  scheduled: number;
  completed: number;
  streak: number;
  /** Last 14 days: true = done, false = missed, null = not scheduled. */
  recent: (boolean | null)[];
}

/** Per-routine consistency over the last `window` days. */
export function routineStats(
  rules: Routine[],
  checks: RoutineCheck[],
  today: string,
  window = 30,
): RoutineStat[] {
  const done = doneSet(checks);
  const dates = Array.from({ length: window }, (_, i) => addDays(today, i - (window - 1)));
  return rules
    .filter((r) => !r.archivedAt)
    .map((rule) => {
      const sched = dates.map((date) =>
        scheduledRules([rule], date).length ? done.has(`${rule.id}:${date}`) : null,
      );
      const scheduled = sched.filter((s) => s !== null).length;
      const completed = sched.filter((s) => s === true).length;
      let streak = 0;
      for (let i = sched.length - 1; i >= 0; i--) {
        const s = sched[i];
        if (s === null) continue;
        if (s) streak++;
        else if (i === sched.length - 1) continue; // today is still open
        else break;
      }
      return {
        rule,
        scheduled,
        completed,
        rate: scheduled ? completed / scheduled : null,
        streak,
        recent: sched.slice(-14),
      };
    });
}

/** Tone for a completion rate; text always carries the number, colour only reinforces it. */
export const rateTone = (score: number | null) =>
  score === null
    ? "text-muted-foreground"
    : score >= 0.8
      ? "text-profit"
      : score >= 0.5
        ? "text-amber-600 dark:text-amber-400"
        : "text-loss";

export const pct = (score: number | null) => (score === null ? "–" : `${Math.round(score * 100)}%`);

export const formatDay = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(
    new Date(`${date}T12:00:00Z`),
  );
