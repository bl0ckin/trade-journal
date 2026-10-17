/** Choices for the emotional state a trade was taken in. */
export const EMOTIONAL_STATES = [
  "Calm",
  "Focused",
  "Confident",
  "Neutral",
  "Excited",
  "Hesitant",
  "Anxious",
  "Fearful",
  "FOMO",
  "Greedy",
  "Overconfident",
  "Frustrated",
  "Angry",
  "Bored",
  "Tired",
] as const;

/** Emotional states are stored as a JSON list; older trades may hold a single plain word. */
export const parseEmotions = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  } catch {
    /* A plain word saved before multiple selection existed. */
  }
  return [raw];
};
