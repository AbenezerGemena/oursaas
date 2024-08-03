export function parseAllowedOrigins(...values: Array<string | undefined | null>) {
  const allowedOrigins = new Set<string>();

  for (const value of values) {
    if (!value) continue;

    for (const origin of value.split(",")) {
      const trimmed = origin.trim();
      if (trimmed) {
        allowedOrigins.add(trimmed);
      }
    }
  }

  return allowedOrigins;
}

export function createCorsOriginChecker(allowedOrigins: Set<string>) {
  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} not allowed by CORS`));
  };
}
