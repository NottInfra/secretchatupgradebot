import { Database } from "./database.js";
import { DeferredWriteQueue } from "./queue.js";
import {
  putSessionCache,
  readSessionByUserId,
  readSessionsListActive,
  runReadQuery,
  type SessionCache
} from "./store-reads.js";
import { runWriteQuery } from "./store-writes.js";
import type { IStore } from "./store.js";
import type { SessionRecord } from "../../lib/types/index.js";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

export class Store implements IStore {
  private readonly backing: Database;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly writeQueue = new DeferredWriteQueue();
  private readonly sessionCache: SessionCache = {
    sessionByUserId: new Map<string, SessionRecord | null>(),
    listActiveSnapshot: undefined
  };

  constructor() {
    this.backing = new Database();
  }

  async close(): Promise<void> {
    await this.backing.close();
  }

  async write(query: string, ...args: unknown[]): Promise<number | void> {
    return this.persist(query, args, true);
  }

  writeDeferred(query: string, ...args: unknown[]): void {
    void this.persist(query, args, false);
  }

  private async persist(query: string, args: unknown[], wait: boolean): Promise<number | void> {
    const run = async (): Promise<number | void> => {
      const result = await runWriteQuery(this.backing, query, args);
      if (query === "incoming_messages.insert" || query === "action_logs.insert" || query === "users.upsert") {
        this.invalidateQueryCache();
      }
      return result;
    };

    if (query === "svc_users.ensure_user") {
      const [userId] = args as [string, string];
      if (!this.sessionCache.sessionByUserId.has(userId)) {
        putSessionCache(this.sessionCache, { userId, active: false });
      }
    } else if (query === "svc_users.set_active") {
      const [userId, active] = args as [string, boolean, string];
      const existing = this.sessionCache.sessionByUserId.get(userId);
      putSessionCache(
        this.sessionCache,
        existing ? { ...existing, active } : { userId, active }
      );
    }

    const queuedRun = async (): Promise<void> => {
      await run();
    };

    if (wait) {
      if (query === "incoming_messages.insert") {
        return run();
      }
      await this.writeQueue.enqueue(query, queuedRun);
      return;
    }

    this.writeQueue.enqueueFireAndForget(query, queuedRun);
  }

  async read<T>(query: string, cacheLifetimeMs = 0, ...args: unknown[]): Promise<T> {
    if (query === "svc_users.find_by_user_id") {
      const [userId] = args as [string];
      return readSessionByUserId(this.backing, this.sessionCache, userId) as Promise<T>;
    }

    if (query === "svc_users.list_active") {
      return readSessionsListActive(this.backing, this.sessionCache) as Promise<T>;
    }

    const now = Date.now();
    const cacheKey = this.buildCacheKey(query, args);
    if (cacheLifetimeMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        return cached.value as T;
      }
    }

    const result = await runReadQuery<T>(this.backing, query, args);
    if (cacheLifetimeMs > 0) {
      this.cache.set(cacheKey, {
        expiresAt: now + cacheLifetimeMs,
        value: result
      });
    }
    return result;
  }

  private buildCacheKey(query: string, args: unknown[]): string {
    return `${query}:${JSON.stringify(args)}`;
  }

  private invalidateQueryCache(): void {
    this.cache.clear();
  }
}
