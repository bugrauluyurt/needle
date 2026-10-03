import { createHash } from "node:crypto";
import type { Auth, Navidrome, NavidromeVerification } from "../navidrome.ts";

export const NAVIDROME_VERIFICATION_ATTEMPT_LIMIT = 10;

const ATTEMPT_WINDOW_MS = 15 * 60_000;
const CONCURRENT_VERIFICATION_LIMIT = 8;
const STATE_ENTRY_LIMIT = 10_000;
const VALID_CREDENTIAL_TTL_MS = 5 * 60_000;

export type NavidromeVerificationResult = NavidromeVerification | "limited";
export type NavidromeVerificationUpstream = Pick<Navidrome, "verify">;

type VerificationContext = {
  clientAddress: string;
};

type VerificationAttempt = {
  count: number;
  expiresAt: number;
};

type InMemoryNavidromeVerifierOptions = {
  attemptLimit?: number;
  attemptWindowMs?: number;
  concurrentLimit?: number;
  entryLimit?: number;
  now?: () => number;
  validCredentialTtlMs?: number;
};

export class InMemoryNavidromeVerifier {
  constructor(upstream: NavidromeVerificationUpstream, options: InMemoryNavidromeVerifierOptions = {}) {
    this.upstream = upstream;
    this.attemptLimit = options.attemptLimit ?? NAVIDROME_VERIFICATION_ATTEMPT_LIMIT;
    this.attemptWindowMs = options.attemptWindowMs ?? ATTEMPT_WINDOW_MS;
    this.concurrentLimit = options.concurrentLimit ?? CONCURRENT_VERIFICATION_LIMIT;
    this.entryLimit = options.entryLimit ?? STATE_ENTRY_LIMIT;
    this.now = options.now ?? Date.now;
    this.validCredentialTtlMs = options.validCredentialTtlMs ?? VALID_CREDENTIAL_TTL_MS;
  }

  async verify(auth: Auth, { clientAddress }: VerificationContext): Promise<NavidromeVerificationResult> {
    const now = this.now();
    const credentialKey = InMemoryNavidromeVerifier.getCredentialKey(auth);
    const verifiedUntil = this.verifiedCredentials.get(credentialKey);

    if (verifiedUntil && verifiedUntil > now) return "ok";
    if (verifiedUntil) this.verifiedCredentials.delete(credentialKey);

    const attemptKey = `${clientAddress}\0${auth.user.toLowerCase()}`;
    const attempt = this.attempts.get(attemptKey);

    if (attempt?.expiresAt && attempt.expiresAt <= now) this.attempts.delete(attemptKey);
    else if (attempt && attempt.count >= this.attemptLimit) return "limited";

    const verificationPromise = this.getVerificationPromise(auth, credentialKey);
    if (!verificationPromise) return "limited";

    const verification = await verificationPromise;

    if (verification === "ok") {
      this.attempts.delete(attemptKey);
      this.setBounded(this.verifiedCredentials, credentialKey, this.now() + this.validCredentialTtlMs);
    } else if (verification === "denied") {
      this.verifiedCredentials.delete(credentialKey);
      this.recordFailure(attemptKey, this.now());
    }

    return verification;
  }

  private static getCredentialKey(auth: Auth): string {
    return createHash("sha256")
      .update(auth.user)
      .update("\0")
      .update(auth.token)
      .update("\0")
      .update(auth.salt)
      .digest("hex");
  }

  private getVerificationPromise(auth: Auth, credentialKey: string): Promise<NavidromeVerification> | null {
    const pendingVerification = this.pendingVerifications.get(credentialKey);
    if (pendingVerification) return pendingVerification;
    if (this.activeVerificationCount >= this.concurrentLimit) return null;

    this.activeVerificationCount += 1;
    const verificationPromise = Promise.resolve()
      .then(() => this.upstream.verify(auth))
      .finally(() => {
        this.activeVerificationCount -= 1;

        if (this.pendingVerifications.get(credentialKey) === verificationPromise) {
          this.pendingVerifications.delete(credentialKey);
        }
      });

    this.pendingVerifications.set(credentialKey, verificationPromise);

    return verificationPromise;
  }

  private recordFailure(attemptKey: string, now: number): void {
    const attempt = this.attempts.get(attemptKey);
    const activeAttempt = attempt && attempt.expiresAt > now ? attempt : null;

    this.setBounded(this.attempts, attemptKey, {
      count: (activeAttempt?.count ?? 0) + 1,
      expiresAt: activeAttempt?.expiresAt ?? now + this.attemptWindowMs,
    });
  }

  private setBounded<Value>(entries: Map<string, Value>, entryKey: string, value: Value): void {
    entries.delete(entryKey);
    entries.set(entryKey, value);

    while (entries.size > this.entryLimit) {
      const oldestEntryKey = entries.keys().next().value;

      if (oldestEntryKey === undefined) return;

      entries.delete(oldestEntryKey);
    }
  }

  private readonly attemptLimit: number;
  private readonly attemptWindowMs: number;
  private readonly concurrentLimit: number;
  private readonly entryLimit: number;
  private readonly now: () => number;
  private readonly upstream: NavidromeVerificationUpstream;
  private readonly validCredentialTtlMs: number;
  private readonly attempts = new Map<string, VerificationAttempt>();
  private readonly pendingVerifications = new Map<string, Promise<NavidromeVerification>>();
  private readonly verifiedCredentials = new Map<string, number>();
  private activeVerificationCount = 0;
}
