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

/** Roles where Enter or Space does the same as a click. */
const ACTIVATES = new Set(['button', 'link', 'clickable', 'menuitem', 'tab', 'switch', 'checkbox', 'radio']);

/**
 * A key press can do what a click does: Enter or Space on a focused button, or Enter in a field, which submits
 * its form. So Enter is judged by the control's own name and, inside a form, by the name of the submit button.
 */
export function classifyAction(
  kind: string,
  target: { role?: string; name?: string; form?: boolean; submit?: string } | null,
  key?: string,
): RiskVerdict {
  const hit = (label: string, what: string): RiskVerdict | null => {
    const m = label.trim().match(HIGH);
    return m ? { risk: 'high', why: `${what} "${label.trim().slice(0, 60)}" looks irreversible (${m[0].toLowerCase()})` } : null;
  };
  const name = target?.name || '';
  if (kind === 'click') return hit(name, '') ?? { risk: 'low' };
  if (kind === 'press') {
    const enter = /^enter$/i.test(key || '');
    const space = /^(space| )$/i.test(key || '');
    if ((enter || space) && target?.role && ACTIVATES.has(target.role)) {
      const v = hit(name, '');
      if (v) return v;
    }
    if (enter && target?.form) {
      const v = hit(target.submit || '', 'submits') ?? hit(name, '');
      if (v) return v;
    }
  }
  return { risk: 'low' };
}
