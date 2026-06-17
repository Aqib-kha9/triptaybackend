export interface IMealOption {
  mealType: "Breakfast" | "Lunch" | "Dinner" | "Snacks" | "All Meals";
  included: boolean;
  extraPrice: number;
  description?: string;
}

export interface INearbyPlace {
  name: string;
  distanceKm: number;
  category: "Restaurant" | "Cafe" | "Market" | "Hospital" | "Pharmacy" | "ATM" | "Bus Stop" | "Railway Station" | "Airport" | "Tourist Spot" | "Trek" | "Lake" | "Temple" | "Other";
  description?: string;
}

export interface IHouseRule {
  rule: string;
  icon?: string;
}

export interface IMediaItem {
  url: string;
  publicId: string;
  type: "photo" | "video";
  caption?: string;
  isCover: boolean;
  order: number;
}

export interface ISeasonalPrice {
  seasonName: string;
  startDate: Date;
  endDate: Date;
  pricePerNight: number;
}

export interface IListing {
  id: string;
  _id: string;
  host: string;
  hostId: string;
  name: string;
  slug: string;
  description: string;
  summary: string;
  propertyType: "Villa" | "Apartment" | "Cottage" | "Farmhouse" | "Homestay" | "Bungalow" | "Tent" | "Treehouse" | "Cabin" | "Houseboat" | "Other";
  floorNumber?: number;
  totalFloors?: number;
  propertySizeSqFt?: number;
  yearBuilt?: number;
  isEntirePlace: boolean;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  landmark?: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  extraMattresses?: number;
  basePrice: number;
  weekendPrice?: number;
  seasonalPrices: ISeasonalPrice[];
  cleaningFee: number;
  securityDeposit: number;
  extraGuestPrice: number;
  taxes: number;
  minStay: number;
  maxStay: number;
  checkInTime: string;
  checkOutTime: string;
  flexibleCheckIn: boolean;
  flexibleCheckOut: boolean;
  amenities: string[];
  meals: IMealOption[];
  hasKitchen: boolean;
  kitchenDetails?: string;
  houseRules: IHouseRule[];
  cancellationPolicy: "Flexible" | "Moderate" | "Strict" | "Non-Refundable";
  cancellationDetails?: string;
  isPetFriendly: boolean;
  petRules?: string;
  isSmokingAllowed: boolean;
  isPartyAllowed: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  nearbyPlaces: INearbyPlace[];
  media: IMediaItem[];
  videoTourUrl?: string;
  instantBook: boolean;
  advanceNoticeHours: number;
  maxGuestsPerBooking: number;
  status: "draft" | "published" | "unlisted" | "rejected";
  isActive: boolean;
  isFeatured: boolean;
  adminNotes?: string;
  avgRating: number;
  totalReviews: number;
  languagesSpoken: string[];
  createdAt: Date;
  updatedAt: Date;
}