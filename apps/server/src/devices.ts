import type { WebSocket } from "ws";
import type { ClientMessage, Device, ServerMessage } from "@needle/shared";

type Conn = { socket: WebSocket; user: string; device: Device | null };

const STALE_MS = 45_000;

export class DeviceHub {
  private readonly conns = new Set<Conn>();

  attach(socket: WebSocket, user: string) {
    const conn: Conn = { socket, user, device: null };
    this.conns.add(conn);
    socket.on("message", (raw) => this.onMessage(conn, Array.isArray(raw) ? Buffer.concat(raw).toString() : Buffer.from(raw as ArrayBuffer).toString()));
    socket.on("close", () => {
      this.conns.delete(conn);
      this.broadcast(user);
    });
    socket.on("pong", () => {
      if (conn.device) conn.device.lastSeen = Date.now();
    });
  }

  private onMessage(conn: Conn, raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "hello") {
      for (const other of this.conns) {
        if (other !== conn && other.user === conn.user && other.device?.id === msg.device.id) other.socket.close(4000, "replaced");
      }
      conn.device = { ...msg.device, lastSeen: Date.now(), state: null };
      this.broadcast(conn.user);
    } else if (msg.type === "state" && conn.device) {
      conn.device.state = msg.state;
      conn.device.lastSeen = Date.now();
      this.broadcast(conn.user);
    } else if (msg.type === "command" && conn.device) {
      const target = [...this.conns].find((c) => c.user === conn.user && c.device?.id === msg.to);
      this.send(target, { type: "command", from: conn.device.id, command: msg.command });
    }
  }

  private send(conn: Conn | undefined, msg: ServerMessage) {
    if (conn?.socket.readyState === conn?.socket.OPEN) conn?.socket.send(JSON.stringify(msg));
  }

  devices(user: string): Device[] {
    return [...this.conns].filter((c) => c.user === user && c.device).map((c) => c.device as Device);
  }

  private broadcast(user: string) {
    const devices = this.devices(user);
    for (const c of this.conns) if (c.user === user) this.send(c, { type: "devices", devices });
  }

  heartbeat() {
    const now = Date.now();
    for (const c of this.conns) {
      if (c.device && now - c.device.lastSeen > STALE_MS) c.socket.terminate();
      else c.socket.ping();
    }
  }
}
