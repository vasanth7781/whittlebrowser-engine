/** Step schema shared by the MCP server and hosted APIs, so every front end accepts exactly the same steps. */
import { z } from 'zod';
import type { Step } from '../driver/session.js';

export const STEP = {
  do: z.enum(['click', 'type', 'select', 'check', 'uncheck', 'hover', 'press', 'scroll', 'upload']),
  ref: z.number().int().optional(),
  text: z.string().optional().describe('type: text, secret:NAME or ‹token›'),
  submit: z.boolean().optional().describe('type: press Enter after'),
  append: z.boolean().optional(),
  values: z.array(z.string()).optional().describe('select: option labels'),
  key: z.string().optional().describe('press: e.g. Enter, Escape, Control+a'),
  dy: z.number().optional().describe('scroll: screens, negative = up'),
  files: z.array(z.string()).optional(),
};
export const stepSchema = z.object(STEP);
/** Entries of steps[]: only `do` is declared (the other fields are the ones above), which keeps the tool definition small. */
export const stepItemSchema = z.object({ do: STEP.do }).passthrough();
export type RawStep = z.infer<typeof stepSchema>;

export function toStep(r: RawStep): Step {
  const need = (k: keyof RawStep) => {
    if (r[k] === undefined) throw new Error(`${r.do} needs ${k}`);
    return r[k] as never;
  };
  switch (r.do) {
    case 'click': case 'hover': case 'check': case 'uncheck': return { do: r.do, ref: need('ref') };
    case 'type': return { do: 'type', ref: need('ref'), text: need('text'), submit: r.submit, append: r.append };
    case 'select': return { do: 'select', ref: need('ref'), values: need('values') };
    case 'press': return { do: 'press', key: need('key'), ref: r.ref };
    case 'scroll': return { do: 'scroll', ref: r.ref, dy: r.dy };
    case 'upload': return { do: 'upload', ref: need('ref'), files: need('files') };
  }
}
