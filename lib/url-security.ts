import dns from "node:dns/promises";
import net from "node:net";

export type UrlLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPrivateAddress(mapped);
  }
  if (net.isIPv4(normalized)) {
    const [first, second] = normalized.split(".").map(Number);
    return first === 0
      || first === 10
      || first === 100 && second >= 64 && second <= 127
      || first === 127
      || first === 169 && second === 254
      || first === 172 && second >= 16 && second <= 31
      || first === 192 && second === 0
      || first === 192 && second === 168
      || first >= 224;
  }
  if (!net.isIPv6(normalized)) return false;
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff");
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  options: {
    lookup?: UrlLookup;
    allowLocalhost?: boolean;
    requireHttps?: boolean;
  } = {},
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const localhost = hostname === "localhost" || hostname === "localhost.localdomain";
  const lookup = options.lookup || ((name) => dns.lookup(name, { all: true }));
  if (localhost && options.allowLocalhost) return url;
  if (options.requireHttps && url.protocol !== "https:") {
    throw new Error("External URLs must use HTTPS");
  }
  if (isPrivateAddress(hostname)) throw new Error("Private URL");

  const addresses = await lookup(hostname);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Private URL");
  }
  return url;
}

export async function readResponseTextBounded(response: Response, maxBytes: number) {
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - total;
      const chunk = next.value.byteLength > remaining ? next.value.slice(0, remaining) : next.value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < next.value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export async function fetchWithValidatedRedirects(
  rawUrl: string,
  init: RequestInit = {},
  options: { lookup?: UrlLookup; maxRedirects?: number; fetcher?: FetchLike } = {},
) {
  const fetcher = options.fetcher || fetch;
  const maxRedirects = options.maxRedirects ?? 4;
  let target = await assertPublicHttpUrl(rawUrl, { lookup: options.lookup });
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetcher(target, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, url: target };
    }
    if (redirects >= maxRedirects) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect without location");
    target = await assertPublicHttpUrl(new URL(location, target).toString(), { lookup: options.lookup });
  }
}
