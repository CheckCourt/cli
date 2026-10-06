import { apiKeyAuth, createCheckCourtClient as createSdkClient, } from "@checkcourt/sdk";
export function createCheckCourtClient(config) {
    return createSdkClient({
        baseUrl: config.baseUrl,
        auth: apiKeyAuth(config.apiKey),
        tenantId: config.tenantId,
        // The interactive CLI reports a 429 at once instead of stalling the screen.
        retry: false,
    });
}
