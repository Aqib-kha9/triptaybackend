export interface IActivityEquipment {
  name: string;
  provided: boolean;
}

export interface IActivityInclusion {
  text: string;
  type: "included" | "excluded";
}

export interface IActivitySlot {
  startTime: string;
  endTime?: string;
  maxParticipants?: number;
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
  pricePerPerson: number;
}

export interface IActivity {
  id: string;
  _id: string;
  host: string;
  hostId: string;
  name: string;
  slug: string;
  description: string;
  summary: string;
  activityType: "Rafting" | "Trekking" | "Paragliding" | "Camping" | "Bungee Jumping" | "Skiing" | "Scuba Diving" | "Safari" | "Cycling" | "Kayaking" | "Rock Climbing" | "Zip Lining" | "Hot Air Balloon" | "Wildlife Safari" | "Cultural Tour" | "Photography Tour" | "Fishing" | "Surfing" | "Caving" | "Other";
  difficulty: "Easy" | "Moderate" | "Challenging" | "Extreme";
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
  meetingPoint?: string;
  durationHours: number;
  durationDays: number;
  startTimes: string[];
  availability: "Daily" | "Weekdays" | "Weekends" | "Custom";
  availabilityNotes?: string;
  minAge: number;
  maxGroupSize: number;
  minGroupSize: number;
  basePrice: number;
  weekendPrice?: number;
  childPrice?: number;
  foreignerPrice?: number;
  seasonalPrices: ISeasonalPrice[];
  taxes: number;
  securityDeposit: number;
  equipmentProvided: string[];
  equipmentRequired: string[];
  safetyGuidelines: string;
  hasInsurance: boolean;
  certifiedGuides: boolean;
  guideRatio?: string;
  included: string[];
  excluded: string[];
  houseRules: IHouseRule[];
  cancellationPolicy: "Flexible" | "Moderate" | "Strict" | "Non-Refundable";
  cancellationDetails?: string;
  isPetFriendly: boolean;
  petRules?: string;
  restrictions?: string;
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