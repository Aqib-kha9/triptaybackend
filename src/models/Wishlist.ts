export interface IWishlist {
  id: string;
  _id: string;
  userId: string;
  itemId: string;
  itemType: "stay" | "activity";
  createdAt: Date;
  updatedAt: Date;
}