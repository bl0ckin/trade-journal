/**
 * Ready-made questions. Each one can be answered from the aggregates the AI is given
 * (overall stats, and results by symbol, weekday, hour, holding time, tag, mistake and playbook).
 */
export const PROMPT_GROUPS: { title: string; prompts: string[] }[] = [
  {
    title: "Performance",
    prompts: [
      "What's my most expensive mistake?",
      "Am I better at longs or shorts?",
      "Which symbols are costing me the most?",
      "Which setups or tags have the best results?",
    ],
  },
  {
    title: "Timing",
    prompts: [
      "Which weekday should I stop trading?",
      "What time of day do I trade best and worst?",
      "Do I do better on quick trades or longer holds?",
    ],
  },
  {
    title: "Review and rules",
    prompts: [
      "Write a short review of this period: what to keep and what to fix.",
      "Give me three rules to follow next week, based on these numbers.",
      "Where do my mistakes cluster?",
    ],
  },
];

/** The four prompts shown on the empty chat. */
export const STARTER_PROMPTS = [
  "What's my most expensive mistake?",
  "Which weekday should I stop trading?",
  "Write a short review of this period: what to keep and what to fix.",
  "Give me three rules to follow next week, based on these numbers.",
];
