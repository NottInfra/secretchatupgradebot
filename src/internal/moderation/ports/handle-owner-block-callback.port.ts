export interface IHandleOwnerBlockCallback {
  execute(ownerUserId: number, token: string): Promise<string>;
}
