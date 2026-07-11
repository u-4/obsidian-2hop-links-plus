export const DEFAULT_REFRESH_DEBOUNCE_MS = 200;
export const METADATA_REFRESH_DEBOUNCE_MS = 500;
export const STARTUP_REFRESH_DELAY_MS = 1500;
export const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000;
export const RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_RESULT_CACHE_ENTRIES = 20;

export class CalculationCancelledError extends Error {
  constructor() {
    super("2Hop Links calculation was superseded");
    this.name = "AbortError";
  }
}

export function isCalculationCancelled(error: unknown): boolean {
  return (
    error instanceof CalculationCancelledError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function throwIfCalculationCancelled(
  signal?: AbortSignal | null
): void {
  if (signal?.aborted) {
    throw new CalculationCancelledError();
  }
}

export class CooperativeTask {
  private operations = 0;
  private lastYieldAt: number;

  constructor(
    private signal?: AbortSignal | null,
    private yieldEvery = 512,
    private maxSliceMs = 8,
    private now: () => number = () => Date.now()
  ) {
    this.lastYieldAt = this.now();
  }

  checkpoint(weight = 1): Promise<void> | null {
    this.operations += weight;
    if (this.operations < this.yieldEvery) {
      return null;
    }

    this.operations = 0;
    throwIfCalculationCancelled(this.signal);
    if (this.now() - this.lastYieldAt < this.maxSliceMs) {
      return null;
    }

    return this.yieldToEventLoop();
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    throwIfCalculationCancelled(this.signal);
    this.lastYieldAt = this.now();
  }
}

export class StartupRefreshGate {
  private layoutReadyAt: number | null = null;
  private firstRefreshStarted = false;

  constructor(
    private startupDelayMs = STARTUP_REFRESH_DELAY_MS,
    private now: () => number = () => Date.now()
  ) {}

  markLayoutReady(): void {
    if (this.layoutReadyAt === null) {
      this.layoutReadyAt = this.now();
    }
  }

  isLayoutReady(): boolean {
    return this.layoutReadyAt !== null;
  }

  getDelay(requestedDelayMs: number): number | null {
    if (this.layoutReadyAt === null) {
      return null;
    }

    const requested = Math.max(0, requestedDelayMs);
    if (this.firstRefreshStarted) {
      return requested;
    }

    const startupRemaining = Math.max(
      0,
      this.layoutReadyAt + this.startupDelayMs - this.now()
    );
    return Math.max(requested, startupRemaining);
  }

  markRefreshStarted(): void {
    if (this.layoutReadyAt !== null) {
      this.firstRefreshStarted = true;
    }
  }
}

export interface TimerApi {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_TIMER_API: TimerApi = {
  setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface DebouncedTaskOptions {
  timerApi?: TimerApi;
  onSupersede?: () => void;
  onError?: (error: unknown) => void;
}

export class DebouncedTask {
  private timerHandle: unknown = null;
  private generation = 0;
  private readonly timerApi: TimerApi;
  private readonly onSupersede?: () => void;
  private readonly onError?: (error: unknown) => void;

  constructor(options: DebouncedTaskOptions = {}) {
    this.timerApi = options.timerApi ?? SYSTEM_TIMER_API;
    this.onSupersede = options.onSupersede;
    this.onError = options.onError;
  }

  schedule(delayMs: number, task: () => void | Promise<void>): void {
    this.onSupersede?.();
    this.clearTimer();
    const generation = ++this.generation;

    this.timerHandle = this.timerApi.setTimeout(() => {
      this.timerHandle = null;
      if (generation !== this.generation) {
        return;
      }

      Promise.resolve(task()).catch((error: unknown) => {
        if (!isCalculationCancelled(error)) {
          this.onError?.(error);
        }
      });
    }, Math.max(0, delayMs));
  }

  cancel(): void {
    this.generation++;
    this.clearTimer();
    this.onSupersede?.();
  }

  private clearTimer(): void {
    if (this.timerHandle !== null) {
      this.timerApi.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }
}
