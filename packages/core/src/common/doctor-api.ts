import OpenAI from "openai";
import { Agent, fetch as undiciFetch } from "undici";

export type ModelsProbe = {
  outcome: "available" | "authentication" | "forbidden" | "unavailable";
  detail: string;
  modelListed?: boolean;
  httpStatus?: number;
};

export function describeNetworkError(error: unknown): string {
  let current = error;
  const codes: string[] = [];
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const record = current as { code?: string; name?: string; cause?: unknown };
    codes.push(record.code ?? "", record.name ?? "");
    current = record.cause;
  }
  if (codes.some((code) => /Timeout|TIMEOUT|ETIMEDOUT|AbortError/i.test(code)))
    return "Request timed out. Check network connectivity and the service address.";
  if (codes.some((code) => /ENOTFOUND|EAI_AGAIN/.test(code)))
    return "DNS lookup failed. Check the hostname and DNS configuration.";
  if (codes.some((code) => /CERT|TLS|SSL|SELF_SIGNED/.test(code)))
    return "TLS verification failed. Check certificates and any HTTPS proxy.";
  if (codes.some((code) => /ECONNREFUSED/.test(code))) return "Connection refused. Check the service address and port.";
  if (codes.some((code) => /ECONNRESET|EPIPE|UND_ERR_SOCKET/.test(code)))
    return "Connection closed unexpectedly. Check the service and network path.";
  return "Unable to connect. Check the service address, network, and proxy configuration.";
}

/** Isolated from the normal client's warmup, cache, and machine-id creation. */
export async function probeModels(options: {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
}): Promise<ModelsProbe> {
  const agent = new Agent();
  const timeout = options.timeoutMs ?? 10_000;
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: 0,
    timeout,
    fetch: (url, init) =>
      undiciFetch(typeof url === "string" || url instanceof URL ? url : url.url, {
        ...init,
        dispatcher: agent,
        redirect: "manual",
      } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>,
  });
  const signal = AbortSignal.timeout(timeout);
  let responseStatus: number | undefined;
  try {
    // SDK Page normalizes a missing `data` field to []; inspect the wire response
    // so an HTML login page or malformed JSON object cannot pass authentication.
    const response = await client.models.list({ signal }).asResponse();
    responseStatus = response.status;
    const data: unknown = await response.json();
    const models: unknown = data && typeof data === "object" ? (data as Record<string, unknown>)["data"] : undefined;
    if (!Array.isArray(models) || models.some((item) => !item || typeof item.id !== "string"))
      return {
        outcome: "unavailable",
        httpStatus: response.status,
        detail:
          "The models endpoint returned an unexpected response. API access and model support could not be verified.",
      };
    return {
      outcome: "available",
      httpStatus: response.status,
      modelListed: models.some((item) => item.id === options.model),
      detail: "Models endpoint accessible. This does not verify generation requests.",
    };
  } catch (error) {
    if (signal.aborted || error instanceof OpenAI.APIConnectionTimeoutError)
      return {
        outcome: "unavailable",
        httpStatus: responseStatus,
        detail: "Request timed out. Check network connectivity and the service address.",
      };
    if (error instanceof OpenAI.APIError && error.status) {
      const status = error.status;
      const detail =
        status === 401
          ? "Authentication was rejected by the models endpoint. Check the key and service address."
          : status === 403
            ? "Access to the models endpoint was denied. Check account permissions or subscription access."
            : status === 404 || status === 405
              ? "Models listing is unavailable at this address. Check BASE_URL; this service may not support /models."
              : status === 429
                ? "The service rate limit or quota was reached. Try again later or check the account quota."
                : status >= 500
                  ? "The service reported a server error. Try again later."
                  : status >= 300 && status < 400
                    ? "The endpoint redirected the request. Configure the final service address."
                    : "The models request failed. Check service compatibility and the configured address.";
      return {
        outcome: status === 401 ? "authentication" : status === 403 ? "forbidden" : "unavailable",
        httpStatus: status,
        detail: `HTTP ${status}: ${detail}`,
      };
    }
    return {
      outcome: "unavailable",
      httpStatus: responseStatus,
      detail:
        error instanceof SyntaxError
          ? "The models endpoint did not return valid JSON. Check BASE_URL and service compatibility."
          : describeNetworkError(error),
    };
  } finally {
    await agent.destroy();
  }
}
