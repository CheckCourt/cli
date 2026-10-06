import {
  apiKeyAuth,
  createCheckCourtClient as createSdkClient,
  type CheckCourtClient,
} from "@checkcourt/sdk";

export type { CheckCourtClient };

export interface CheckCourtConfig {
  baseUrl: string;
  apiKey: string;
  // Required for every club-scoped call with a personal key; /me/tenants
  // works without it and is how you discover the ids.
  tenantId?: string;
}

export function createCheckCourtClient(config: CheckCourtConfig): CheckCourtClient {
  return createSdkClient({
    baseUrl: config.baseUrl,
    auth: apiKeyAuth(config.apiKey),
    tenantId: config.tenantId,
    // The interactive CLI reports a 429 at once instead of stalling the screen.
    retry: false,
  });
}
