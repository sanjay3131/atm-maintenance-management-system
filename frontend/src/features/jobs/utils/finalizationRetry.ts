export type FinalizationAttempt = (
  uploadIntentId: string,
) => Promise<unknown>;

export interface FinalizationRetryCoordinator {
  run(uploadIntentId: string, attempt: FinalizationAttempt): Promise<boolean>;
  retry(uploadIntentId: string, attempt: FinalizationAttempt): Promise<boolean>;
  markAttempted(uploadIntentId: string): void;
  hasAttempted(uploadIntentId: string): boolean;
  isLocked(): boolean;
}

export const createFinalizationRetryCoordinator =
  (): FinalizationRetryCoordinator => {
    let locked = false;
    const attempted = new Set<string>();

    const run = async (
      uploadIntentId: string,
      attempt: FinalizationAttempt,
    ): Promise<boolean> => {
      if (locked) return false;
      locked = true;
      attempted.add(uploadIntentId);
      try {
        await attempt(uploadIntentId);
        attempted.delete(uploadIntentId);
        return true;
      } catch {
        return false;
      } finally {
        locked = false;
      }
    };

    return {
      run,
      retry: (uploadIntentId, attempt) => {
        if (locked) return Promise.resolve(false);
        attempted.delete(uploadIntentId);
        return run(uploadIntentId, attempt);
      },
      markAttempted: (uploadIntentId) => {
        attempted.add(uploadIntentId);
      },
      hasAttempted: (uploadIntentId) => attempted.has(uploadIntentId),
      isLocked: () => locked,
    };
  };
