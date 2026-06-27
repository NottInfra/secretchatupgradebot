export interface IHandlePolicy {
  execute(userId: number, command: string): Promise<void>;
}
