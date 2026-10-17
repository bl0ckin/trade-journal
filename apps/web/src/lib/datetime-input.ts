import { formatTimestamp } from "./timezone";

const pad = (value: number) => String(value).padStart(2, "0");

/** "Right now" as a datetime-local value in the device's timezone (to the second). */
export const nowDeviceInput = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** "Right now" as a datetime-local value in the given journal timezone. */
export const nowZonedInput = (timeZone: string): string =>
  isoToZonedInput(new Date().toISOString(), timeZone);

/** An ISO instant as a datetime-local value (YYYY-MM-DDTHH:mm:ss) in the given timezone. */
export const isoToZonedInput = (iso: string, timeZone: string): string =>
  formatTimestamp(iso, timeZone).replace(" ", "T");

/** A datetime-local value read as wall-clock time in `timeZone`; null when unparseable. */
export const zonedInputToIso = (value: string, timeZone: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const naive = Date.UTC(year!, month! - 1, day!, hour!, minute!, second ?? 0);
  const offsetAt = (ms: number) => {
    const [date, time] = formatTimestamp(new Date(ms).toISOString(), timeZone).split(" ");
    const [y, mo, d] = date!.split("-").map(Number);
    const [h, mi, s] = time!.split(":").map(Number);
    return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!) - ms;
  };
  let guess = naive - offsetAt(naive);
  guess = naive - offsetAt(guess);
  const result = new Date(guess);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
};
