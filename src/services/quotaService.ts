/**
 * Quota Service - Fetches and parses quota data from Language Server
 */

import { makeRequest } from '../utils/httpClient';
import { ServerInfo } from '../platform/processDiscovery';
import { infoLog, warnLog, errorLog, debugLog } from '../utils/logger';

export interface ModelQuotaInfo {
    label: string;              // "Pro", "Flash"
    modelId: string;            // "gemini-1.5-pro-002"
    remainingPercentage: number; // 85
    isExhausted: boolean;       // false
    resetTime: Date;            // Date object
    timeUntilReset: string;     // "2h 30m"
}

export interface QuotaData {
    remainingPercentage: number;
    resetTime?: Date;
    models: ModelQuotaInfo[];
    isLoggedIn: boolean;  // true when user is logged in (has plan)
}

interface RawModelConfig {
    label: string;
    modelOrAlias?: {
        model?: string;
    };
    quotaInfo?: {
        remainingFraction?: number;
        resetTime?: string;
    };
}

interface ServerResponse {
    userStatus?: {
        name?: string;
        email?: string;
        userTier?: {
            name?: string;
        };
        planStatus?: {
            planInfo?: {
                monthlyPromptCredits?: number;
            };
            availablePromptCredits?: number;
        };
        cascadeModelConfigData?: {
            clientModelConfigs?: RawModelConfig[];
        };
    };
}

/**
 * Fetch quota data from Language Server
 */
export async function fetchQuotaData(serverInfo: ServerInfo): Promise<QuotaData | null> {
    debugLog('[QuotaService] Fetching quota data...');

    try {
        const response = await makeRequest<ServerResponse>(
            '127.0.0.1',
            serverInfo.port,
            '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            {
                'X-Codeium-Csrf-Token': serverInfo.csrfToken,
                'Connect-Protocol-Version': '1',
            },
            JSON.stringify({
                metadata: {
                    ideName: 'antigravity',
                    extensionName: 'antigravity',
                    locale: 'en',
                },
            }),
            12000 // 12 second timeout
        );

        // Check for auth errors
        if (response.statusCode === 401 || response.statusCode === 403) {
            warnLog(`[QuotaService] Authentication failed: HTTP ${response.statusCode}`);
            return null;
        }

        // Check for successful response
        if (response.statusCode !== 200) {
            errorLog(`[QuotaService] HTTP error: ${response.statusCode}`);
            return null;
        }

        // Parse response
        const data = response.data;

        if (!data?.userStatus?.planStatus) {
            errorLog('[QuotaService] Invalid response structure - missing userStatus.planStatus');
            return null;
        }

        return parseQuotaResponse(data);
    } catch (error) {
        errorLog('[QuotaService] Error fetching quota', error);
        return null;
    }
}

/**
 * Parse server response into QuotaData
 */
function parseQuotaResponse(data: ServerResponse): QuotaData | null {
    const planStatus = data.userStatus?.planStatus;
    if (!planStatus) {
        return null;
    }

    const monthly = planStatus.planInfo?.monthlyPromptCredits ?? 0;
    const available = planStatus.availablePromptCredits ?? 0;

    debugLog(`[QuotaService] Plan check: monthly=${monthly}, available=${available}`);

    // Check for "Logged Out" state based on panel-main logic
    // User is considered logged in ONLY if they have credits AND (name OR tier)
    const hasName = !!data.userStatus?.name;
    const hasTier = !!data.userStatus?.userTier;
    const hasIdentity = hasName || hasTier;

    if (monthly === 0 || !hasIdentity) {
        warnLog(`[QuotaService] ⚠️ User is LOGGED OUT (monthly=${monthly}, hasIdentity=${hasIdentity})`);
        return {
            remainingPercentage: 0,
            models: [],
            isLoggedIn: false
        };
    }

    const remainingPercentage = (available / monthly) * 100;

    // Parse model-specific quotas
    const rawModels = data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
    const models: ModelQuotaInfo[] = rawModels
        .filter((m: RawModelConfig) => m.quotaInfo)
        .map((m: RawModelConfig) => {
            const now = new Date();
            let resetTime = new Date(m.quotaInfo!.resetTime || 0);

            // Handle invalid resetTime - use 24h from now as fallback
            if (Number.isNaN(resetTime.getTime())) {
                resetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            }

            const diff = resetTime.getTime() - now.getTime();
            const remainingFraction = m.quotaInfo!.remainingFraction ?? 0;

            return {
                label: m.label,  // Full API label (e.g., "Gemini 1.5 Pro", "Gemini 2.0 Flash Thinking")
                modelId: m.modelOrAlias?.model || 'unknown',
                remainingPercentage: remainingFraction * 100,
                isExhausted: remainingFraction === 0,
                resetTime,
                timeUntilReset: formatTime(diff),
            };
        });

    return {
        remainingPercentage,
        models,
        isLoggedIn: true // Explicitly set to true when logged in
    };
}

/**
 * Format time duration in human-readable format
 */
function formatTime(ms: number): string {
    if (ms <= 0) return 'Ready';
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h`;
    }
    return `${hours}h ${mins % 60}m`;
}
