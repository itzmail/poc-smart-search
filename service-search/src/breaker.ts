// Circuit breaker ringan: setelah `threshold` kegagalan beruntun, tolak panggilan
// selama `cooldownMs`, lalu izinkan satu percobaan (half-open).
export interface Breaker {
  allow(): boolean;
  success(): void;
  failure(): void;
}

export function createBreaker(threshold = 5, cooldownMs = 15_000): Breaker {
  let failures = 0;
  let openUntil = 0;
  return {
    allow: () => Date.now() >= openUntil,
    success: () => {
      failures = 0;
      openUntil = 0;
    },
    failure: () => {
      failures++;
      if (failures >= threshold) openUntil = Date.now() + cooldownMs;
    },
  };
}

export const jevBreaker = createBreaker();
export const appEducationBreaker = createBreaker();
