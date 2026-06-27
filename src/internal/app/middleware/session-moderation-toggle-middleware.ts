import type { ISessionRepository } from "../../session/ports/session-repository.port.js";

export class SessionModerationToggleMiddleware {
  constructor(private readonly sessions: ISessionRepository) {}

  async isEnabled(sessionId: string): Promise<boolean> {
    const record = await this.sessions.findByUserId(sessionId);
    return record?.active === true;
  }
}
