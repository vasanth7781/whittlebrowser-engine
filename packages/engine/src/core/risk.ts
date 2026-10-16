/**
 * Classifies actions by reversibility. High-risk actions (money, deletion, publishing, sending,
 * granting access) need explicit approval before they run.
 */
export type Risk = 'low' | 'high';

const HIGH =
  /\b(pay|payment|purchase|buy( now)?|place (your |my )?order|complete (order|purchase|payment|booking)|confirm (and )?(pay|order|purchase|payment|transfer|booking)|book now|checkout|transfer|send money|wire|withdraw|donate|subscribe|delete|remove account|erase|destroy|close (my )?account|deactivate|cancel (my )?(subscription|account|order|plan)|unsubscribe|publish|post|tweet|send|reply all|submit (order|payment|application|claim|return)|sign (and submit|contract|document)|e-?sign|authori[sz]e|approve|grant|allow access|accept (offer|invitation)|install|merge|deploy|revoke|reset password|change password|disable (2fa|two-factor)|empty trash)\b/i;

export interface RiskVerdict {
  risk: Risk;
  why?: string;
}

export function classifyAction(kind: string, target: { role?: string; name?: string; form?: boolean } | null, key?: string): RiskVerdict {
  const name = (target?.name || '').trim();
  if (kind === 'click' || (kind === 'press' && /^enter$/i.test(key || '') && target?.form)) {
    const m = name.match(HIGH);
    if (m) return { risk: 'high', why: `"${name.slice(0, 60)}" looks irreversible (${m[0].toLowerCase()})` };
  }
  return { risk: 'low' };
}
