export type AutomationMessageShape = {
  message_id: number;
  chat: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean; username?: string };
  text?: string;
  business_connection_id?: string;
  sender_business_bot?: { id: number; username?: string };
};

export function extractAutomationMessage(update: object): AutomationMessageShape | undefined {
  const record = update as Record<string, unknown>;
  const bm = record.business_message as AutomationMessageShape | undefined;
  if (bm && typeof bm.business_connection_id === "string" && bm.business_connection_id.length > 0) {
    return bm;
  }
  const m = record.message as AutomationMessageShape | undefined;
  if (m && typeof m.business_connection_id === "string" && m.business_connection_id.length > 0) {
    return m;
  }
  return undefined;
}

export type BusinessConnectionOwner = {
  ownerUserId: string;
  sessionOwnerUsername: string | undefined;
};

export async function resolveBusinessConnectionOwner(
  telegram: {
    callApi<M extends string, P extends object>(
      method: M,
      payload: P
    ): Promise<{ user?: { id: number; username?: string } }>;
  },
  businessConnectionId: string
): Promise<BusinessConnectionOwner | undefined> {
  const conn = await telegram.callApi("getBusinessConnection", {
    business_connection_id: businessConnectionId
  });
  const id = conn.user?.id;
  if (typeof id !== "number") return undefined;
  return {
    ownerUserId: String(id),
    sessionOwnerUsername:
      typeof conn.user?.username === "string" && conn.user.username.length > 0
        ? conn.user.username
        : undefined
  };
}
