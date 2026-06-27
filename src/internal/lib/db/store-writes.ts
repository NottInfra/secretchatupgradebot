import type { Database } from "./database.js";
import type { ModerationDecision } from "../../lib/types/index.js";

type WriteHandler = (backing: Database, args: unknown[]) => Promise<number | void>;

async function insertIncomingMessage(backing: Database, args: unknown[]): Promise<number> {
  const [senderId, receiverId, createdAt] = args as [string, string, string];
  const rows = await backing.query<{ id: string }>(
    `INSERT INTO incoming_messages(sender_id, receiver_id, created_at)
     VALUES ($1, $2, $3::timestamptz)
     RETURNING id`,
    [senderId, receiverId, createdAt]
  );
  return Number(rows[0]?.id ?? 0);
}

async function insertActionLog(backing: Database, args: unknown[]): Promise<void> {
  const [incomingMessageId, decision, createdAt] = args as [number, ModerationDecision, string];
  await backing.query(
    `INSERT INTO action_logs(incoming_message_id, decision, created_at)
     VALUES ($1, $2, $3::timestamptz)`,
    [incomingMessageId, decisionToDbValue(decision), createdAt]
  );
}

async function ensureSvcUser(backing: Database, args: unknown[]): Promise<void> {
  const [userId, now] = args as [string, string];
  await backing.query(
    `INSERT INTO svc_users(user_id, active, created_at, updated_at)
     VALUES ($1, FALSE, $2::timestamptz, $2::timestamptz)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, now]
  );
}

async function setSvcUserActive(backing: Database, args: unknown[]): Promise<void> {
  const [userId, active, now] = args as [string, boolean, string];
  await backing.query(
    `INSERT INTO svc_users(user_id, active, created_at, updated_at)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz)
     ON CONFLICT(user_id)
     DO UPDATE SET active = EXCLUDED.active, updated_at = EXCLUDED.updated_at`,
    [userId, active, now]
  );
}

async function upsertUser(backing: Database, args: unknown[]): Promise<void> {
  const [telegramId, username, firstName, lastName, now] = args as [
    number,
    string,
    string,
    string,
    string
  ];
  await backing.query(
    `INSERT INTO users(telegram_id, username, first_name, last_name, last_seen_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz, $5::timestamptz)
     ON CONFLICT(telegram_id)
     DO UPDATE SET
       username = CASE WHEN btrim(EXCLUDED.username) = '' THEN users.username ELSE EXCLUDED.username END,
       first_name = CASE WHEN btrim(EXCLUDED.first_name) = '' THEN users.first_name ELSE EXCLUDED.first_name END,
       last_name = CASE WHEN btrim(EXCLUDED.last_name) = '' THEN users.last_name ELSE EXCLUDED.last_name END,
       last_seen_at = EXCLUDED.last_seen_at,
       updated_at = NOW()`,
    [telegramId, username, firstName, lastName, now]
  );
}

const writeHandlers: Record<string, WriteHandler> = {
  "incoming_messages.insert": insertIncomingMessage,
  "action_logs.insert": insertActionLog,
  "svc_users.ensure_user": ensureSvcUser,
  "svc_users.set_active": setSvcUserActive,
  "users.upsert": upsertUser
};

export async function runWriteQuery(
  backing: Database,
  query: string,
  args: unknown[]
): Promise<number | void> {
  const handler = writeHandlers[query];
  if (!handler) throw new Error(`unknown write query: ${query}`);
  return handler(backing, args);
}

function decisionToDbValue(decision: ModerationDecision): string {
  if (decision.action === "block") return "block";
  if (decision.action === "ignore") return "ignore";
  return "warn";
}
