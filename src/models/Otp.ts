export interface IOtp {
  id: string;
  _id: string;
  identifier: string;
  code: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
