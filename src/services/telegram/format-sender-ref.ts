function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Clickable sender label for mgmt-bot HTML (tg:// deep link). */
export function formatSenderRefHtml(senderId: string, senderUsername?: string): string {
  const username = senderUsername?.trim().replace(/^@/, "");
  if (username) {
    const safe = escapeHtml(username);
    return `<a href="tg://resolve?domain=${safe}">@${safe}</a>`;
  }
  const safeId = escapeHtml(senderId);
  return `<a href="tg://user?id=${safeId}">User ID ${safeId}</a>`;
}
