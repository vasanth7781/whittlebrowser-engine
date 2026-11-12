// Cloudflare Pages Function: POST /api/waitlist. Needs a D1 database bound to the Pages project as DB (see DEPLOY.md).
import { handleWaitlist } from '../../lib/waitlist.mjs';

const d1Store = (db) => ({
  async add(email, interest, createdAt) {
    await db.prepare('INSERT INTO waitlist (email, interest, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (email, interest) DO NOTHING').bind(email, interest, createdAt).run();
  },
});

export const onRequest = ({ request, env }) => handleWaitlist(request, d1Store(env.DB));
