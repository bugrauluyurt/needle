export const ApiErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  INTEGRATION_NOT_CONFIGURED: "INTEGRATION_NOT_CONFIGURED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  YOUTUBE_MUSIC_AUTH_RECONNECT: "auth_reconnect",
  YOUTUBE_MUSIC_BUSY: "busy",
  YOUTUBE_MUSIC_DISABLED: "disabled",
  YOUTUBE_MUSIC_LOGIN_LIMITED: "login_limited",
  YOUTUBE_MUSIC_NOT_CONNECTED: "not_connected",
  YOUTUBE_MUSIC_PLAYBACK_UNAVAILABLE: "playback_unavailable",
  YOUTUBE_MUSIC_QUOTA: "quota",
  YOUTUBE_MUSIC_RUNTIME_MISSING: "runtime_missing",
  YOUTUBE_MUSIC_TIMEOUT: "timeout",
  YOUTUBE_MUSIC_UPSTREAM: "upstream",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export type ApiValidationIssue = {
  path: string;
  message: string;
};

export type ApiError = {
  error: string;
  code: ApiErrorCode;
  requestId: string;
  issues?: ApiValidationIssue[];
};
