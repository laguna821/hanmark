export interface AuthenticatedBatchUploadDependencies<T> {
  readonly requestInitialKey: () => Promise<string | null>;
  readonly requestReplacementKey: () => Promise<string | null>;
  readonly upload: (item: T, apiKey: string) => Promise<string>;
  readonly isAuthenticationFailure: (error: unknown) => boolean;
  readonly cacheAuthenticatedKey: (apiKey: string) => void;
  readonly clearRejectedKey: () => void;
}

export interface AuthenticatedBatchUploadSuccess<T> {
  readonly item: T;
  readonly remoteUrl: string;
}

export interface AuthenticatedBatchUploadFailure<T> {
  readonly item: T;
  readonly kind: "authentication" | "upload";
}

export interface AuthenticatedBatchUploadResult<T> {
  readonly successes: readonly AuthenticatedBatchUploadSuccess<T>[];
  readonly failures: readonly AuthenticatedBatchUploadFailure<T>[];
  readonly initialKeyCancelled: boolean;
  readonly replacementKeyCancelled: boolean;
  readonly stoppedAfterAuthenticationFailure: boolean;
  readonly authenticationRefreshes: number;
}

/**
 * Upload a batch with at most one explicit authentication refresh.
 *
 * A 401/403-style failure stops normal iteration immediately. The current
 * item is retried only after one replacement-key request. If that retry fails,
 * or another authentication failure occurs later, the remaining items stay
 * local instead of repeatedly prompting or hammering the Worker.
 */
export async function uploadBatchWithSingleAuthenticationRefresh<T>(
  items: readonly T[],
  dependencies: AuthenticatedBatchUploadDependencies<T>
): Promise<AuthenticatedBatchUploadResult<T>> {
  const successes: AuthenticatedBatchUploadSuccess<T>[] = [];
  const failures: AuthenticatedBatchUploadFailure<T>[] = [];
  let apiKey = await dependencies.requestInitialKey();
  if (!apiKey) {
    return {
      successes,
      failures,
      initialKeyCancelled: true,
      replacementKeyCancelled: false,
      stoppedAfterAuthenticationFailure: false,
      authenticationRefreshes: 0
    };
  }

  let authenticationRefreshes = 0;
  let replacementKeyCancelled = false;
  let stoppedAfterAuthenticationFailure = false;

  itemLoop:
  for (const item of items) {
    while (true) {
      try {
        const remoteUrl = await dependencies.upload(item, apiKey);
        successes.push({ item, remoteUrl });
        dependencies.cacheAuthenticatedKey(apiKey);
        break;
      } catch (error) {
        if (!dependencies.isAuthenticationFailure(error)) {
          failures.push({ item, kind: "upload" });
          break;
        }

        dependencies.clearRejectedKey();
        if (authenticationRefreshes >= 1) {
          failures.push({ item, kind: "authentication" });
          stoppedAfterAuthenticationFailure = true;
          break itemLoop;
        }

        authenticationRefreshes += 1;
        const replacementKey = await dependencies.requestReplacementKey();
        if (!replacementKey) {
          failures.push({ item, kind: "authentication" });
          replacementKeyCancelled = true;
          stoppedAfterAuthenticationFailure = true;
          break itemLoop;
        }
        apiKey = replacementKey;
        // Retry the same item exactly once with the replacement key.
      }
    }
  }

  return {
    successes,
    failures,
    initialKeyCancelled: false,
    replacementKeyCancelled,
    stoppedAfterAuthenticationFailure,
    authenticationRefreshes
  };
}
