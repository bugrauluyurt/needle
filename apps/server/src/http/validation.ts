import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { validationError } from "./errors.ts";

export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (result.success) return;

    throw validationError(
      result.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.map(String).join(".") : target,
        message: issue.message,
      })),
    );
  });
}
