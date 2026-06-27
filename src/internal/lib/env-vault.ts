export async function loadSecretsFromVault(projectPath: string): Promise<void> {
  const addr = process.env.VAULT_ADDR?.replace(/\/$/, "");
  const token = process.env.VAULT_READ_TOKEN?.trim();
  if (!addr || !token) {
    throw new Error("VAULT_ADDR and VAULT_READ_TOKEN required for Vault env load");
  }

  const res = await fetch(`${addr}/v1/secret/data/${projectPath}`, {
    headers: { "X-Vault-Token": token }
  });
  if (!res.ok) {
    throw new Error(`Vault read failed for secret/${projectPath}: HTTP ${res.status}`);
  }

  const body = (await res.json()) as { data?: { data?: Record<string, string> } };
  const data = body.data?.data;
  if (!data || Object.keys(data).length === 0) {
    throw new Error(`Vault secret/${projectPath} is empty`);
  }

  for (const [key, value] of Object.entries(data)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

export function secretsAlreadyInjected(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() && process.env.TELEGRAM_API_HASH?.trim());
}

export function vaultProjectForNodeEnv(nodeEnv: string, packageName: string): string | null {
  if (nodeEnv === "production") return `live-${packageName}`;
  if (nodeEnv === "test") return `test-${packageName}`;
  return null;
}
