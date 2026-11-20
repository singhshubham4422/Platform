import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { Errors } from '../../lib/errors.js';
import { withRequestTx } from '../../lib/scoped-sql.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', { preHandler: [authenticate] }, async (request) => {
    const q = request.query as { unreadOnly?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    return withRequestTx(async (tx) => {
      const r = await tx.query(
        `SELECT id, type, title, body, link, read_at AS "readAt", created_at AS "createdAt" FROM notifications
         WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) ORDER BY created_at DESC LIMIT $3`,
        [request.user!.userId, q.unreadOnly === 'true', limit],
      );
      const unread = await tx.query<{ n: number }>(`SELECT COUNT(*)::int n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [request.user!.userId]);
      return { items: r.rows, unread: unread.rows[0].n };
    });
  });

  app.patch('/api/notifications/:id/read', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return withRequestTx(async (tx) => {
      const r = await tx.query(`UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2 RETURNING id`, [id, request.user!.userId]);
      if (!r.rowCount) throw Errors.notFound('Notification not found');
      return { read: true };
    });
  });

  app.post('/api/notifications/read-all', { preHandler: [authenticate] }, async (request) =>
    withRequestTx(async (tx) => {
      const r = await tx.query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [request.user!.userId]);
      return { updated: r.rowCount };
    }),
  );
}
