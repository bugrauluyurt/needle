import { randomUUID } from "node:crypto";
import {
  ApiErrorCode,
  type ApiError,
  type ApiErrorCode as ApiErrorCodeType,
  type ApiValidationIssue,
} from "@needle/shared";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { LidarrError } from "../lidarr.ts";
import { ListenBrainzError } from "../listenbrainz.ts";
import { MusicBrainzError } from "../musicbrainz.ts";
import { SubsonicFailure } from "../navidrome.ts";
import { SlskdError } from "../soulseek.ts";
import { SpotifyError } from "../spotify.ts";
import { YouTubeMusicError } from "../youtube-music.ts";
import type { App, AppContext } from "./context.ts";

type AppErrorOptions = {
  code: ApiErrorCodeType;
  issues?: ApiValidationIssue[];
  status: ContentfulStatusCode;
};

export class AppError extends Error {
  readonly code: ApiErrorCodeType;
  readonly issues: ApiValidationIssue[] | undefined;
  readonly status: ContentfulStatusCode;

  constructor(message: string, { code, issues, status }: AppErrorOptions) {
    super(message);
    this.code = code;
    this.issues = issues;
    this.status = status;
  }
}

export function registerErrorHandler(app: App) {
  app.use("*", async (context, next) => {
    const requestId = randomUUID();

    context.set("requestId", requestId);
    context.header("x-request-id", requestId);

    await next();
  });

  app.onError((error, context) => {
    const appError = getAppError(error);

    if (appError.code === ApiErrorCode.INTERNAL_ERROR) {
      console.error(`[${context.get("requestId")}]`, error);
    }

    return getErrorResponse(context, appError);
  });

  app.notFound((context) => getErrorResponse(context, appError(404, ApiErrorCode.NOT_FOUND, "Not found")));
}

export function appError(status: AppErrorOptions["status"], code: ApiErrorCodeType, message: string): AppError {
  return new AppError(message, { code, status });
}

export function validationError(issues: ApiValidationIssue[]): AppError {
  return new AppError("Invalid request", {
    code: ApiErrorCode.VALIDATION_ERROR,
    issues,
    status: 400,
  });
}

function getAppError(error: Error): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof YouTubeMusicError) {
    return appError(error.status, getYouTubeMusicErrorCode(error), error.message);
  }

  if (error instanceof SpotifyError) {
    const status = error.status === 401 || error.status === 409 ? error.status : 502;

    return appError(status, getErrorCodeForStatus(status), error.message);
  }

  if (error instanceof ListenBrainzError) {
    return appError(error.status, getErrorCodeForStatus(error.status), error.message);
  }

  if (
    error instanceof LidarrError ||
    error instanceof SubsonicFailure ||
    error instanceof SlskdError ||
    error instanceof MusicBrainzError
  ) {
    return appError(502, ApiErrorCode.UPSTREAM_ERROR, error.message);
  }

  if (error instanceof HTTPException && error.status === 400) {
    return validationError([{ path: "json", message: error.message }]);
  }

  if (error instanceof HTTPException) {
    return appError(error.status, getErrorCodeForStatus(error.status), error.message);
  }

  return appError(500, ApiErrorCode.INTERNAL_ERROR, "Something went wrong on the Needle server");
}

function getErrorResponse(context: AppContext, error: AppError) {
  const apiErrorBody: ApiError = {
    error: error.message,
    code: error.code,
    requestId: context.get("requestId"),
    ...(error.issues ? { issues: error.issues } : {}),
  };

  return context.json(apiErrorBody, error.status);
}

function getErrorCodeForStatus(status: number): ApiErrorCodeType {
  switch (status) {
    case 400:
      return ApiErrorCode.VALIDATION_ERROR;
    case 401:
      return ApiErrorCode.UNAUTHORIZED;
    case 403:
      return ApiErrorCode.FORBIDDEN;
    case 404:
      return ApiErrorCode.NOT_FOUND;
    case 409:
      return ApiErrorCode.CONFLICT;
    case 413:
      return ApiErrorCode.PAYLOAD_TOO_LARGE;
    case 415:
      return ApiErrorCode.UNSUPPORTED_MEDIA_TYPE;
    case 429:
      return ApiErrorCode.RATE_LIMITED;
    case 503:
      return ApiErrorCode.SERVICE_UNAVAILABLE;
    case 500:
      return ApiErrorCode.INTERNAL_ERROR;
    default:
      return ApiErrorCode.UPSTREAM_ERROR;
  }
}

function getYouTubeMusicErrorCode(error: YouTubeMusicError): ApiErrorCodeType {
  switch (error.code) {
    case ApiErrorCode.YOUTUBE_MUSIC_AUTH_RECONNECT:
    case ApiErrorCode.YOUTUBE_MUSIC_BUSY:
    case ApiErrorCode.YOUTUBE_MUSIC_DISABLED:
    case ApiErrorCode.YOUTUBE_MUSIC_LOGIN_LIMITED:
    case ApiErrorCode.YOUTUBE_MUSIC_NOT_CONNECTED:
    case ApiErrorCode.YOUTUBE_MUSIC_PLAYBACK_UNAVAILABLE:
    case ApiErrorCode.YOUTUBE_MUSIC_QUOTA:
    case ApiErrorCode.YOUTUBE_MUSIC_RUNTIME_MISSING:
    case ApiErrorCode.YOUTUBE_MUSIC_TIMEOUT:
    case ApiErrorCode.YOUTUBE_MUSIC_UPSTREAM:
      return error.code;
    default:
      return getErrorCodeForStatus(error.status);
  }
}
