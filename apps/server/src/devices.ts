import type { WebSocket } from "ws";
import { REPLACED_CLOSE_CODE } from "@needle/shared";
import type { ClientMessage, Device, ServerMessage } from "@needle/shared";

type Conn = { socket: WebSocket; user: string; device: Device | null };

const STALE_MS = 45_000;

export class DeviceHub {
  private readonly conns = new Set<Conn>();
  private readonly active = new Map<string, string>();

  attach(socket: WebSocket, user: string) {
    const conn: Conn = { socket, user, device: null };
    this.conns.add(conn);
    socket.on("message", (raw) => this.onMessage(conn, Array.isArray(raw) ? Buffer.concat(raw).toString() : Buffer.from(raw as ArrayBuffer).toString()));
    socket.on("close", () => {
      this.conns.delete(conn);
      const id = conn.device?.id;
      if (id && this.active.get(user) === id && !this.find(user, id)) this.active.delete(user);
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
      conn.device = { ...msg.device, lastSeen: Date.now(), state: null };
      for (const other of this.conns) {
        if (other !== conn && other.user === conn.user && other.device?.id === msg.device.id) other.socket.close(REPLACED_CLOSE_CODE, "replaced");
      }
      this.broadcast(conn.user);
    } else if (msg.type === "state" && conn.device) {
      const { id } = conn.device;
      const wasPlaying = this.active.get(conn.user) === id && Boolean(conn.device.state?.playing);
      conn.device.state = msg.state;
      conn.device.lastSeen = Date.now();
      if (msg.state?.playing && !wasPlaying) this.takeOver(conn.user, id);
      this.broadcast(conn.user);
    } else if (msg.type === "command" && conn.device) {
      this.send(this.find(conn.user, msg.to), { type: "command", from: conn.device.id, command: msg.command });
    }
  }

  private find(user: string, id: string): Conn | undefined {
    return [...this.conns].find((c) => c.user === user && c.device?.id === id);
  }

  private takeOver(user: string, id: string) {
    this.active.set(user, id);
    for (const c of this.conns) {
      if (c.user === user && c.device && c.device.id !== id && c.device.state?.playing) this.send(c, { type: "command", from: id, command: { action: "pause" } });
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
    const activeId = this.active.get(user) ?? null;
    for (const c of this.conns) if (c.user === user) this.send(c, { type: "devices", devices, activeId });
  }

  heartbeat() {
    const now = Date.now();
    for (const c of this.conns) {
      if (c.device && now - c.device.lastSeen > STALE_MS) c.socket.terminate();
      else c.socket.ping();
    }
  }
}
