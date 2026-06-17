export interface ILastMessage {
  text: string;
  sender: string;
  sentAt: Date;
}

export interface IConversation {
  id: string;
  _id: string;
  participants: string[];
  listingId?: string;
  activityId?: string;
  bookingContext?: {
    title: string;
    dateRange: string;
    type: "listing" | "activity";
  };
  lastMessage?: ILastMessage;
  unreadCount: any;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}