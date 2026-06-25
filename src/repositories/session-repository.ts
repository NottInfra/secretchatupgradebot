import type { SessionRecord } from "../types.js";
import type { Store } from "../utils/db/root.js";

export class SessionRepository {
  constructor(private readonly store: Store) {}

  async listActive(): Promise<SessionRecord[]> {
    return this.store.read<SessionRecord[]>("svc_users.list_active", 3000);
  }

  async findByUserId(userId: string): Promise<SessionRecord | null> {
    return this.store.read<SessionRecord | null>("svc_users.find_by_user_id", 0, userId);
  }

  async ensureUser(userId: string): Promise<void> {
    await this.store.write("svc_users.ensure_user", userId, new Date().toISOString());
  }

  async setActive(userId: string, active: boolean): Promise<void> {
    await this.store.write("svc_users.set_active", userId, active, new Date().toISOString());
  }
}
