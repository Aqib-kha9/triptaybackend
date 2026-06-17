export interface IUser {
  id: string;
  _id: string;
  name: string;
  email: string;
  password: string;
  phone?: string;
  avatar?: string;
  website?: string;
  role: "Guest" | "Vendor" | "Dual Mode" | "Admin";
  status: "Active" | "Blocked";
  walletBalance: number;
  panNumber?: string;
  gstin?: string;
  bankAccount?: string;
  bankIFSC?: string;
  kycStatus: "Pending" | "Approved" | "Rejected" | "Not Submitted";
  aadharFront?: string;
  aadharBack?: string;
  panCardImage?: string;
  createdAt: Date;
  updatedAt: Date;
}
