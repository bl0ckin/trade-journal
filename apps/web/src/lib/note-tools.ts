/** Small helpers shared by the daily journal and the notebook. */

/** Plain text from markdown, for previews. */
export const stripMarkdown = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Markdown task-list progress: `- [x]` done out of every `- [ ]` / `- [x]`. */
export function taskProgress(markdown: string) {
  const matches = markdown.match(/^\s*[-*+]\s+\[[ xX]\]/gm) ?? [];
  const done = matches.filter((line) => /\[[xX]\]/.test(line)).length;
  return { done, total: matches.length };
}

export interface OutlineItem {
  level: number;
  text: string;
}

/** Headings in document order. Fenced code blocks are skipped. */
export function outline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) items.push({ level: match[1]!.length, text: match[2]!.replace(/[*_`]/g, "") });
  }
  return items;
}

export const wordCount = (markdown: string) => {
  const text = markdown.trim();
  return text ? text.split(/\s+/).length : 0;
};

/** Sections that can be dropped into a day note with one click. */
export const DAY_PROMPTS = [
  {
    id: "plan",
    label: "Pre-market plan",
    content:
      "## Pre-market plan\n\n**Market context:** \n\n**Levels to watch:** \n\n**Setups I will take:**\n- \n\n**Max loss for the day:** \n",
  },
  {
    id: "review",
    label: "Session review",
    content:
      "## Session review\n\n**What went well:**\n- \n\n**What went wrong:**\n- \n\n**Did I follow my plan?** \n",
  },
  {
    id: "emotions",
    label: "Emotional check-in",
    content: "## Emotional check-in\n\n**Before trading:** \n\n**During:** \n\n**After:** \n",
  },
  {
    id: "lessons",
    label: "Lessons and tomorrow",
    content: "## Lessons and tomorrow\n\n**Key lesson:** \n\n**Tomorrow I will:**\n- [ ] \n- [ ] \n",
  },
] as const;

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  title: (today: string) => string;
  content: string;
}

/** Starter notes for the notebook. */
export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "trade-plan",
    name: "Trade plan",
    description: "Thesis, entry, stop and targets before you click.",
    title: (today) => `Trade plan · ${today}`,
    content:
      "## Setup\n\n**Instrument:** \n**Direction:** \n**Thesis:** \n\n## Levels\n\n- Entry: \n- Stop: \n- Target 1: \n- Target 2: \n\n## Risk\n\n- Risk per trade: \n- Position size: \n\n## Invalidation\n\nI am wrong if: \n",
  },
  {
    id: "weekly-review",
    name: "Weekly review",
    description: "Results, patterns and one thing to change.",
    title: (today) => `Weekly review · ${today}`,
    content:
      "## Results\n\n- Net P&L: \n- Best trade: \n- Worst trade: \n\n## What worked\n\n- \n\n## What did not\n\n- \n\n## Rule breaks\n\n- \n\n## One change for next week\n\n- [ ] \n",
  },
  {
    id: "monthly-review",
    name: "Monthly review",
    description: "Zoom out: stats, habits and goals.",
    title: (today) => `Monthly review · ${today.slice(0, 7)}`,
    content:
      "## Numbers\n\n- Net P&L: \n- Win rate: \n- Profit factor: \n\n## Best habits\n\n- \n\n## Habits to fix\n\n- \n\n## Goals for next month\n\n- [ ] \n- [ ] \n- [ ] \n",
  },
  {
    id: "checklist",
    name: "Pre-session checklist",
    description: "A tick-list to run before the open.",
    title: () => "Pre-session checklist",
    content:
      "## Before the open\n\n- [ ] Slept well and ready to trade\n- [ ] Checked the economic calendar\n- [ ] Marked key levels\n- [ ] Wrote down max loss for the day\n- [ ] Reviewed my rules\n\n## After the close\n\n- [ ] Logged every trade\n- [ ] Wrote the day note\n",
  },
  {
    id: "lessons",
    name: "Lessons learned",
    description: "Capture a mistake so you do not repeat it.",
    title: () => "Lesson learned",
    content:
      "## What happened\n\n\n## Why it happened\n\n\n## What I will do differently\n\n- [ ] \n",
  },
  {
    id: "idea",
    name: "Strategy idea",
    description: "Hypothesis, rules and how you will test it.",
    title: () => "Strategy idea",
    content:
      "## Hypothesis\n\n\n## Rules\n\n- Entry: \n- Exit: \n- Risk: \n\n## How I will test it\n\n- [ ] \n\n## Results\n\n",
  },
];
