import type { Database } from "./database.js";
import type { SessionRecord } from "../../lib/types/index.js";

type ReadHandler = (backing: Database, args: unknown[]) => Promise<unknown>;

async function countBySender(backing: Database, args: unknown[]): Promise<number> {
  const [senderId, receiverId, collapseWindowSeconds = 0] = args as [string, string, number?];
  if (collapseWindowSeconds <= 0) {
    const rows = await backing.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM incoming_messages
       WHERE sender_id = $1 AND receiver_id = $2`,
      [senderId, receiverId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  const rows = await backing.query<{ n: string }>(
    `WITH ordered AS (
       SELECT
         created_at,
         LAG(created_at) OVER (ORDER BY created_at) AS previous_created_at
       FROM incoming_messages
       WHERE sender_id = $1 AND receiver_id = $2
     )
     SELECT COUNT(*)::text AS n
     FROM ordered
     WHERE previous_created_at IS NULL
        OR created_at - previous_created_at > make_interval(secs => $3)`,
    [senderId, receiverId, collapseWindowSeconds]
  );
  return Number(rows[0]?.n ?? 0);
}

async function countInInstance(backing: Database, args: unknown[]): Promise<number> {
  const [senderId, atIso, collapseWindowSeconds] = args as [string, string, number];
  const rows = await backing.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM incoming_messages
     WHERE sender_id = $1
       AND created_at <= $2::timestamptz
       AND created_at > $2::timestamptz - make_interval(secs => $3)`,
    [senderId, atIso, collapseWindowSeconds]
  );
  return Number(rows[0]?.n ?? 0);
}

async function hasPriorBlockInSession(backing: Database, args: unknown[]): Promise<boolean> {
  const [senderId, receiverId] = args as [string, string];
  const rows = await backing.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM action_logs al
       JOIN incoming_messages im ON im.id = al.incoming_message_id
       WHERE im.sender_id = $1
         AND im.receiver_id = $2
         AND al.decision = 'block'
     ) AS exists`,
    [senderId, receiverId]
  );
  return Boolean(rows[0]?.exists);
}

async function hasPriorBlockByOtherSession(backing: Database, args: unknown[]): Promise<boolean> {
  const [senderId, receiverId] = args as [string, string];
  const rows = await backing.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM action_logs al
       JOIN incoming_messages im ON im.id = al.incoming_message_id
       WHERE im.sender_id = $1
         AND im.receiver_id <> $2
         AND al.decision = 'block'
     ) AS exists`,
    [senderId, receiverId]
  );
  return Boolean(rows[0]?.exists);
}

async function listActiveSessions(backing: Database): Promise<SessionRecord[]> {
  const rows = await backing.query<{ user_id: string; active: boolean }>(
    `SELECT user_id, active FROM svc_users WHERE active = TRUE`
  );
  return rows.map((row) => ({ userId: row.user_id, active: row.active }));
}

async function findSessionByUserId(backing: Database, args: unknown[]): Promise<SessionRecord | null> {
  const [userId] = args as [string];
  const rows = await backing.query<{ user_id: string; active: boolean }>(
    `SELECT user_id, active FROM svc_users WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return { userId: row.user_id, active: row.active };
}

const readHandlers: Record<string, ReadHandler> = {
  "incoming_messages.count_by_sender": countBySender,
  "incoming_messages.count_in_instance": countInInstance,
  "action_logs.has_prior_block_in_session": hasPriorBlockInSession,
  "action_logs.has_prior_block_by_other_session": hasPriorBlockByOtherSession,
  "svc_users.list_active": (backing) => listActiveSessions(backing),
  "svc_users.find_by_user_id": findSessionByUserId
};

export async function runReadQuery<T>(backing: Database, query: string, args: unknown[]): Promise<T> {
  const handler = readHandlers[query];
  if (!handler) throw new Error(`unknown read query: ${query}`);
  return (await handler(backing, args)) as T;
}

export type SessionCache = {
  sessionByUserId: Map<string, SessionRecord | null>;
  listActiveSnapshot: SessionRecord[] | undefined;
};

export function putSessionCache(cache: SessionCache, record: SessionRecord): void {
  cache.sessionByUserId.set(record.userId, record);
  cache.listActiveSnapshot = undefined;
}

export async function readSessionByUserId(
  backing: Database,
  cache: SessionCache,
  userId: string
): Promise<SessionRecord | null> {
  if (cache.sessionByUserId.has(userId)) {
    return cache.sessionByUserId.get(userId) ?? null;
  }
  const record = await runReadQuery<SessionRecord | null>(backing, "svc_users.find_by_user_id", [userId]);
  cache.sessionByUserId.set(userId, record);
  return record;
}

export async function readSessionsListActive(
  backing: Database,
  cache: SessionCache
): Promise<SessionRecord[]> {
  if (cache.listActiveSnapshot) {
    return cache.listActiveSnapshot;
  }
  const rows = await runReadQuery<SessionRecord[]>(backing, "svc_users.list_active", []);
  cache.listActiveSnapshot = rows;
  return rows;
}
