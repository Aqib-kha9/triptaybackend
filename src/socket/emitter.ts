import { Server as SocketIOServer } from "socket.io";

let ioInstance: SocketIOServer | null = null;

export function setSocketIO(io: SocketIOServer): void {
  ioInstance = io;
}

export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

export function emitToUser(userId: string, event: string, data: any): void {
  if (ioInstance) {
    ioInstance.to(userId).emit(event, data);
  }
}

export function emitToAdmins(event: string, data: any): void {
  if (ioInstance) {
    ioInstance.to("admin-room").emit(event, data);
  }
}
