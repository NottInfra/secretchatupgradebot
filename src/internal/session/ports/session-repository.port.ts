import type { SessionRecord } from "../../lib/types/index.js";

export interface ISessionRepository {
  listActive(): Promise<SessionRecord[]>;
  findByUserId(userId: string): Promise<SessionRecord | null>;
  ensureUser(userId: string): Promise<void>;
  setActive(userId: string, active: boolean): Promise<void>;
}
