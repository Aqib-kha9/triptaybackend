export type MessageType = "text" | "image" | "file" | "system";

export interface IMessage {
  id: string;
  _id: string;
  conversation: string;
  conversationId: string;
  sender: string;
  senderId: string;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  fileSize?: number;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}