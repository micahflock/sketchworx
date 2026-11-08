/** Command search: match typed text against command names and a few extra words people might type. */

export interface Command {
  id: string;
  label: string;
  /** Named action run by App.runAction ("tool:line", "zoomFit", ...). */
  action: string;
  icon: string;
  /** Group shown beside the name ("Draw", "View", ...). */
  group: string;
  /** Other words that should find this command ("measure" finds Smart Dimension). */
  keywords?: string[];
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Lower is better; null when it does not match.
 * 0 the name starts with the query, 1 every typed word starts a word of the name,
 * 2 the letters are the name's initials ("sd" → Smart Dimension), 3 the name contains the query,
 * 4 every typed word starts a word of the name or keywords.
 */
export function matchScore(cmd: Command, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 5;
  const label = cmd.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  const typed = words(q);
  const lw = words(cmd.label);
  const startsAWord = (pool: string[]) => typed.every((t) => pool.some((w) => w.startsWith(t)));
  if (typed.length && startsAWord(lw)) return 1;
  const initials = lw.map((w) => w[0]).join("");
  if (!q.includes(" ") && q.length >= 2 && initials.startsWith(q)) return 2;
  if (label.includes(q)) return 3;
  const kw = cmd.keywords?.flatMap(words) ?? [];
  if (typed.length && startsAWord([...lw, ...kw, ...words(cmd.group)])) return 4;
  return null;
}

/** Matching commands, best first; ties keep the list's own order. */
export function searchCommands(cmds: Command[], query: string): Command[] {
  return cmds
    .map((c, i) => ({ c, i, s: matchScore(c, query) }))
    .filter((x): x is { c: Command; i: number; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.c);
}
