export interface INotification {
  id: string;
  _id: string;
  recipient: string;
  recipientId: string;
  type: "booking" | "payout" | "message" | "system" | "kyc" | "review";
  title: string;
  description: string;
  link?: string;
  metadata?: any;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}