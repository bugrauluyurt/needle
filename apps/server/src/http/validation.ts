import { zValidator } from "@hono/zod-validator";
import { ApiErrorCode } from "@needle/shared";
import type { ValidationTargets } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { appError, validationError } from "./errors.ts";

export const JSON_BODY_MAX_BYTES = 64 * 1024;

type RequestBodyLimitOptions = {
  maxBytes: number;
  message?: string;
};

export const jsonBodyLimit = getRequestBodyLimit({ maxBytes: JSON_BODY_MAX_BYTES });

export function getRequestBodyLimit({ maxBytes, message = "Request body is too large" }: RequestBodyLimitOptions) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw appError(413, ApiErrorCode.PAYLOAD_TOO_LARGE, message);
    },
  });
}

export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (schemaValidationResult) => {
    if (schemaValidationResult.success) return;

    throw validationError(
      schemaValidationResult.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.map(String).join(".") : target,
        message: issue.message,
      })),
    );
  });
}
