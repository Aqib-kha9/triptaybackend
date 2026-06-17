export interface IAvailability {
  id: string;
  _id: string;
  host: string;
  hostId: string;
  itemId: string;
  itemType: "listing" | "activity";
  blockedDates: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}