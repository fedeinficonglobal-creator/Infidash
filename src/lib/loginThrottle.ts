interface LoginThrottleOptions {
  maxAttempts?: number;
  windowMs?: number;
  now?: () => number;
  maxEntries?: number;
}

interface FailureWindow {
  attempts: number;
  startedAt: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, FailureWindow>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: LoginThrottleOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  check(key: string) {
    const now = this.now();
    this.prune(now);
    const entry = this.entries.get(key);
    if (!entry || now - entry.startedAt >= this.windowMs || entry.attempts < this.maxAttempts) {
      return { blocked: false, retryAfterSeconds: 0 };
    }
    return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + this.windowMs - now) / 1000)) };
  }

  recordFailure(key: string) {
    const now = this.now();
    this.prune(now);
    const current = this.entries.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.entries.set(key, { attempts: 1, startedAt: now });
    } else {
      current.attempts += 1;
      this.entries.set(key, current);
    }
    if (this.entries.size > this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
    }
  }

  recordSuccess(key: string) {
    this.entries.delete(key);
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt >= this.windowMs) this.entries.delete(key);
    }
  }
}
