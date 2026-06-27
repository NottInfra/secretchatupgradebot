export interface IToggleModeration {
  execute(userId: number): Promise<void>;
}
