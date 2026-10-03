import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { Input } from "hono/types";
import type { AppEnv } from "./context.ts";

const UNRESOLVED_CLIENT_ADDRESS = "unresolved";

type ClientAddressOptions = {
  trustedProxy: boolean;
};

export function getClientAddress<Path extends string, ContextInput extends Input>(
  context: Context<AppEnv, Path, ContextInput>,
  { trustedProxy }: ClientAddressOptions,
): string {
  const remoteAddress = getRemoteAddress(context);

  if (!trustedProxy) return remoteAddress;

  const forwardedAddresses = context.req.header("x-forwarded-for")?.split(",");
  const forwardedAddress = forwardedAddresses?.at(-1)?.trim();

  return forwardedAddress && isIP(forwardedAddress) ? getNormalizedAddress(forwardedAddress) : remoteAddress;
}

function getRemoteAddress<Path extends string, ContextInput extends Input>(
  context: Context<AppEnv, Path, ContextInput>,
): string {
  try {
    const remoteAddress = getConnInfo(context).remote.address?.trim();

    return remoteAddress ? getNormalizedAddress(remoteAddress) : UNRESOLVED_CLIENT_ADDRESS;
  } catch {
    return UNRESOLVED_CLIENT_ADDRESS;
  }
}

function getNormalizedAddress(address: string): string {
  const ipv4Address = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : "";

  return isIP(ipv4Address) === 4 ? ipv4Address : address;
}
