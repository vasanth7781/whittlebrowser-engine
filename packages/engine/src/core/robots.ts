/** Minimal robots.txt evaluation (RFC 9309 longest-match, Allow wins ties) for agent-initiated navigation. */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(txt: string, agent: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'allow' && value) cur.allow.push(value);
    if (field === 'disallow' && value) cur.disallow.push(value);
  }
  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((x) => x !== '*' && a.includes(x)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

function matchLen(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const re = new RegExp('^' + pattern.replace(/\$$/, '').replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
  return re.test(path) ? pattern.length : -1;
}

export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best = -1, allowed = true;
  for (const p of rules.disallow) { const l = matchLen(p, pathAndQuery); if (l > best) { best = l; allowed = false; } }
  for (const p of rules.allow) { const l = matchLen(p, pathAndQuery); if (l >= best && l >= 0) { best = l; allowed = true; } }
  return allowed;
}
