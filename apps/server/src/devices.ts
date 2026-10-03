import { REPLACED_CLOSE_CODE, type ClientMessage, type Device, type ServerMessage } from "@needle/shared";
import { ClientMessageSchema } from "@needle/shared/schemas/devices";
import type { WebSocket } from "ws";

const INVALID_MESSAGE_CLOSE_CODE = 1008;
const INVALID_MESSAGE_REASON = "invalid message";
const STALE_MS = 45_000;

type AttachOptions = {
  managesEvents?: boolean;
};

export type DeviceConnection = {
  socket: WebSocket;
  user: string;
  device: Device | null;
};

export class DeviceHub {
  attach(socket: WebSocket, user: string, { managesEvents = true }: AttachOptions = {}): DeviceConnection {
    const connection: DeviceConnection = { socket, user, device: null };

    this.connections.add(connection);

    if (managesEvents) {
      socket.on("message", (message) => this.receive(connection, message));
      socket.on("close", () => this.detach(connection));
    }

    socket.on("pong", () => this.markSeen(connection));

    return connection;
  }

  receive(connection: DeviceConnection, rawMessage: unknown) {
    const message = DeviceHub.getClientMessage(rawMessage);

    if (!message) {
      connection.socket.close(INVALID_MESSAGE_CLOSE_CODE, INVALID_MESSAGE_REASON);

      return;
    }

    switch (message.type) {
      case "hello":
        this.hello(connection, message);
        break;
      case "state":
        this.updateState(connection, message);
        break;
      case "command":
        this.forwardCommand(connection, message);
        break;
      default:
        message satisfies never;
    }
  }

  detach(connection: DeviceConnection) {
    this.connections.delete(connection);

    const deviceId = connection.device?.id;

    if (deviceId && this.activeDevices.get(connection.user) === deviceId && !this.find(connection.user, deviceId)) {
      this.activeDevices.delete(connection.user);
    }

    this.broadcast(connection.user);
  }

  markSeen(connection: DeviceConnection) {
    if (connection.device) connection.device.lastSeen = Date.now();
  }

  devices(user: string): Device[] {
    return [...this.connections].flatMap((connection) =>
      connection.user === user && connection.device ? [connection.device] : [],
    );
  }

  heartbeat() {
    const now = Date.now();

    for (const connection of this.connections) {
      if (connection.device && now - connection.device.lastSeen > STALE_MS) connection.socket.terminate();
      else connection.socket.ping();
    }
  }

  private hello(connection: DeviceConnection, message: Extract<ClientMessage, { type: "hello" }>) {
    connection.device = {
      ...message.device,
      lastSeen: Date.now(),
      state: null,
    };

    for (const otherConnection of this.connections) {
      if (
        otherConnection !== connection &&
        otherConnection.user === connection.user &&
        otherConnection.device?.id === message.device.id
      ) {
        otherConnection.socket.close(REPLACED_CLOSE_CODE, "replaced");
      }
    }

    this.broadcast(connection.user);
  }

  private updateState(connection: DeviceConnection, message: Extract<ClientMessage, { type: "state" }>) {
    if (!connection.device) return;

    const deviceId = connection.device.id;
    const wasPlaying =
      this.activeDevices.get(connection.user) === deviceId && Boolean(connection.device.state?.playing);

    connection.device.state = message.state;
    connection.device.lastSeen = Date.now();

    if (message.state?.playing && !wasPlaying) this.takeOver(connection.user, deviceId);

    this.broadcast(connection.user);
  }

  private forwardCommand(connection: DeviceConnection, message: Extract<ClientMessage, { type: "command" }>) {
    if (!connection.device) return;

    this.send(this.find(connection.user, message.to), {
      type: "command",
      from: connection.device.id,
      command: message.command,
    });
  }

  private find(user: string, deviceId: string): DeviceConnection | undefined {
    return [...this.connections].find((connection) => connection.user === user && connection.device?.id === deviceId);
  }

  private takeOver(user: string, deviceId: string) {
    this.activeDevices.set(user, deviceId);

    for (const connection of this.connections) {
      if (
        connection.user === user &&
        connection.device &&
        connection.device.id !== deviceId &&
        connection.device.state?.playing
      ) {
        this.send(connection, {
          type: "command",
          from: deviceId,
          command: { action: "pause" },
        });
      }
    }
  }

  private send(connection: DeviceConnection | undefined, message: ServerMessage) {
    if (!connection || connection.socket.readyState !== connection.socket.OPEN) return;

    try {
      connection.socket.send(JSON.stringify(message));
    } catch {
      connection.socket.terminate();
    }
  }

  private broadcast(user: string) {
    const devices = this.devices(user);
    const activeId = this.activeDevices.get(user) ?? null;

    for (const connection of this.connections) {
      if (connection.user === user) this.send(connection, { type: "devices", devices, activeId });
    }
  }

  private static getClientMessage(rawMessage: unknown): ClientMessage | null {
    const messageText = DeviceHub.getMessageText(rawMessage);

    if (messageText === null) return null;

    try {
      const result = ClientMessageSchema.safeParse(JSON.parse(messageText));

      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  private static getMessageText(rawMessage: unknown): string | null {
    if (typeof rawMessage === "string") return rawMessage;
    if (rawMessage instanceof ArrayBuffer) return Buffer.from(rawMessage).toString();
    if (ArrayBuffer.isView(rawMessage)) {
      return Buffer.from(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength).toString();
    }
    if (Array.isArray(rawMessage) && rawMessage.every((messagePart) => messagePart instanceof Uint8Array)) {
      return Buffer.concat(rawMessage).toString();
    }

    return null;
  }

  private readonly connections = new Set<DeviceConnection>();
  private readonly activeDevices = new Map<string, string>();
}
