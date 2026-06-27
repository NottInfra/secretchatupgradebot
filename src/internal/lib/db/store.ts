/** Persistence port — repositories depend on this interface, not the concrete Store. */
export interface IStore {
  close(): Promise<void>;
  write(query: string, ...args: unknown[]): Promise<number | void>;
  writeDeferred(query: string, ...args: unknown[]): void;
  read<T>(query: string, ttlMs: number, ...args: unknown[]): Promise<T>;
}
