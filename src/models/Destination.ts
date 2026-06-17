export interface IDestination {
  id: string;
  _id: string;
  name: string;
  slug: string;
  state: string;
  city: string;
  image: string;
  category: "Nature" | "Adventure" | "Historical" | "Spiritual";
  coordinates: {
    lat: number;
    lng: number;
  };
  description: string;
  isActive: boolean;
  popularityScore: number;
  createdAt: Date;
  updatedAt: Date;
}