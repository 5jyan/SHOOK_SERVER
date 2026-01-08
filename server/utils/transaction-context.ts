import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "crypto";

type TransactionContext = {
  transactionId: string;
  path?: string;
  userId?: number;
  type?: "request" | "batch";
};

const storage = new AsyncLocalStorage<TransactionContext>();

const base62Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const base62Max = 256 - (256 % base62Alphabet.length);

function randomSuffix(length: number = 8): string {
  let result = "";
  while (result.length < length) {
    const bytes = randomBytes(length);
    for (const value of bytes) {
      if (value >= base62Max) {
        continue;
      }
      result += base62Alphabet[value % base62Alphabet.length];
      if (result.length >= length) {
        break;
      }
    }
  }

  return result;
}

export function createRequestTransactionId(userId?: number | null): string {
  const userPart = userId ?? 0;
  return `${userPart}_${randomSuffix(8)}`;
}

export function createBatchTransactionId(): string {
  return `batch_${randomSuffix(8)}`;
}

export function runWithTransactionContext<T>(context: TransactionContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function runWithRequestContext<T>(path: string, userId: number | undefined, fn: () => T): T {
  const transactionId = createRequestTransactionId(userId);
  return runWithTransactionContext({ transactionId, path, userId, type: "request" }, fn);
}

export function runWithBatchContext<T>(path: string, fn: () => T): T {
  const transactionId = createBatchTransactionId();
  return runWithTransactionContext({ transactionId, path, type: "batch" }, fn);
}

export function getTransactionId(): string | undefined {
  return storage.getStore()?.transactionId;
}
