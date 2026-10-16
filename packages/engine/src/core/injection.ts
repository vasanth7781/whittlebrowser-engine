/**
 * Flags page text that reads like instructions aimed at an AI agent (indirect prompt injection).
 * This is a tripwire, not a guarantee: the primary defences are dropping hidden/deceptive text in the
 * page agent, origin scoping, risk gating and the privacy filter. Flagged lines are prefixed with ⚠ so
 * the model treats them as data.
 */
const PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b.{0,30}\b(instructions?|prompts?|rules|guidelines|directions|context)\b/i,
  /\b(you are now|from now on,? you|act as an?|pretend (to be|you are)|new instructions?|system prompt|developer mode|jailbreak)\b/i,
  /\b(ai|assistant|agent|llm|model|chatbot|chatgpt|claude|gemini|copilot|operator)\b[^.]{0,40}\b(must|should|needs? to|is instructed to|are instructed to|has to)\b/i,
  /\b(send|forward|email|post|upload|exfiltrate|leak|paste|share)\b[^.]{0,50}\b(password|credentials?|api[ -]?keys?|tokens?|cookies?|otp|one[- ]time|2fa|session|ssn|card number)\b/i,
  /<\/?\s*(system|instructions?|assistant|im_start|im_end)\s*>|\[\/?(system|INST)\]|<\|im_(start|end)\|>/i,
  /\b(do not|don't|never) (tell|inform|alert|notify|show|mention (this )?to) the user\b/i,
  /\bbefore (answering|responding|continuing)\b[^.]{0,40}\b(visit|open|navigate|go to|call)\b/i,
];

/** Pattern sources, so the in-page agent can mark suspicious text for the X-ray view. */
export const INJECTION_SOURCES: string[] = PATTERNS.map((r) => r.source);

export function looksLikeInjection(text: string): boolean {
  if (!text || text.length < 12) return false;
  for (const re of PATTERNS) if (re.test(text)) return true;
  return false;
}
