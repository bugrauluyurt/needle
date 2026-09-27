const FORWARD_REQUEST = ["range", "accept", "if-none-match", "if-modified-since", "if-range", "content-type"];
const DROP_RESPONSE = ["connection", "keep-alive", "transfer-encoding", "content-encoding", "server", "x-powered-by"];
const IMMUTABLE = /\/rest\/getCoverArt(\.view)?$/;
const COMPRESSIBLE = /json|xml|text/;

export async function proxyToNavidrome(req: Request, navidromeUrl: string): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers({ "accept-encoding": "identity" });
  for (const name of FORWARD_REQUEST) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(`${navidromeUrl}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    ...(hasBody ? { duplex: "half" } : {}),
  });

  const out = new Headers(upstream.headers);
  for (const name of DROP_RESPONSE) out.delete(name);
  if (IMMUTABLE.test(url.pathname) && upstream.ok) {
    out.set("cache-control", "public, max-age=31536000, immutable");
  }

  const type = out.get("content-type") ?? "";
  const gzip = upstream.body && COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
  if (gzip && upstream.body) {
    out.delete("content-length");
    out.set("content-encoding", "gzip");
    out.append("vary", "accept-encoding");
    return new Response(upstream.body.pipeThrough(new CompressionStream("gzip")), { status: upstream.status, headers: out });
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
