import * as vscode from 'vscode';

interface ModelUsageInfo {
    modelId: string;           // "gemini-1.5-pro-002"
    label: string;             // "Pro"
    lastPercentage: number;    // 85.0
    lastUsedTimestamp: number; // Date.now()
}

/**
 * UsageTracker - Tracks model usage by monitoring percentage decreases
 * Stores history in ExtensionContext.globalState for persistence
 */
export class UsageTracker {
    private history: ModelUsageInfo[] = [];
    private readonly STORAGE_KEY = 'antigravity-observer.modelUsageHistory';
    private readonly MAX_HISTORY_SIZE = 10;
    private readonly USAGE_THRESHOLD = 0.01; // 0.01% minimum decrease to count as usage

    constructor(private context: vscode.ExtensionContext) {
        this.loadHistory();
    }

    /**
     * Track model usage based on percentage decrease
     * Call this after each successful quota fetch
     */
    trackUsage(models: Array<{
        modelId: string;
        label: string;
        remainingPercentage: number;
    }>): void {
        const now = Date.now();
        let historyChanged = false;

        for (const model of models) {
            const existing = this.history.find(h => h.modelId === model.modelId);

            if (existing) {
                // Check for usage: percentage DECREASED
                const decrease = existing.lastPercentage - model.remainingPercentage;

                if (decrease >= this.USAGE_THRESHOLD) {
                    // Usage detected!
                    existing.lastUsedTimestamp = now;
                    existing.lastPercentage = model.remainingPercentage;
                    historyChanged = true;

                    console.log(`[UsageTracker] Usage detected: ${model.label} ${existing.lastPercentage.toFixed(1)}% → ${model.remainingPercentage.toFixed(1)}%`);
                } else {
                    // No usage, just update percentage (could be quota reset)
                    existing.lastPercentage = model.remainingPercentage;
                }
            } else {
                // New model - add to history
                this.history.push({
                    modelId: model.modelId,
                    label: model.label,
                    lastUsedTimestamp: now,
                    lastPercentage: model.remainingPercentage
                });
                historyChanged = true;
            }
        }

        if (historyChanged) {
            // Sort by last used (newest first)
            this.history.sort((a, b) => b.lastUsedTimestamp - a.lastUsedTimestamp);

            // Limit history size
            this.history = this.history.slice(0, this.MAX_HISTORY_SIZE);

            // Persist to storage
            this.saveHistory();
        }
    }

    /**
     * Get N most recently used model IDs
     * Returns in order: newest → oldest
     */
    getRecentlyUsedModels(count: number = 3): string[] {
        return this.history
            .slice(0, count)
            .map(h => h.modelId);
    }

    /**
     * Get full usage info (for debugging/tooltip)
     */
    getUsageInfo(): ModelUsageInfo[] {
        return [...this.history];
    }

    /**
     * Load history from storage
     */
    private loadHistory(): void {
        const stored = this.context.globalState.get<ModelUsageInfo[]>(
            this.STORAGE_KEY,
            []
        );
        this.history = stored;
        console.log(`[UsageTracker] Loaded ${this.history.length} models from history`);
    }

    /**
     * Save history to storage
     */
    private saveHistory(): void {
        this.context.globalState.update(this.STORAGE_KEY, this.history);
    }

    /**
     * Clear usage history (for testing/reset)
     */
    clearHistory(): void {
        this.history = [];
        this.saveHistory();
        console.log('[UsageTracker] History cleared');
    }
}
