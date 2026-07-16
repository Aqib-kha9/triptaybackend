import { z } from "zod";
//   Enums 
export const RoleEnum = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      const lower = val.toLowerCase();
      if (lower === "guest") return "Guest";
      if (lower === "vendor") return "Vendor";
      if (lower === "dual mode" || lower === "dual_mode") return "Dual Mode";
      if (lower === "admin") return "Admin";
    }
    return val;
  },
  z.enum(["Guest", "Vendor", "Dual Mode", "Admin"])
);
export const KYCStatusEnum = z.enum(["Not Submitted", "Pending", "Approved", "Rejected"]);
export const DestinationCategoryEnum = z.enum(["Nature", "Adventure", "Historical", "Spiritual"]);
export const PropertyTypeEnum = z.enum(["Apartment", "Villa", "House", "Cottage", "Farm Stay", "Homestay", "Resort", "Camping", "Boat House", "Tree House", "Other"]);
export const ActivityTypeEnum = z.enum(["Trekking", "Rafting", "Paragliding", "Camping", "Wildlife Safari", "Water Sports", "Cultural Tour", "Food Tour", "Photography", "Yoga & Wellness", "Other"]);
export const DifficultyEnum = z.enum(["Easy", "Moderate", "Difficult", "Extreme"]);
export const CancellationPolicyEnum = z.enum(["Flexible", "Moderate", "Strict", "Non-refundable"]);
export const ListingStatusEnum = z.enum(["draft", "published", "rejected", "blocked"]);
export const ItemTypeEnum = z.enum(["listing", "activity", "stay"]);
export const WishlistItemTypeEnum = z.enum(["listing", "activity"]);
export const MessageTypeEnum = z.enum(["text", "image", "file", "system"]);

//   Auth  
export const signupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email").transform((e) => e.toLowerCase()),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().optional(),
  role: RoleEnum.optional().default("Guest"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email").transform((e) => e.toLowerCase()),
  password: z.string().min(1, "Password is required"),
});

export const sendOtpSchema = z.object({
  identifier: z.string().min(1, "Email or mobile number is required").transform((e) => e.toLowerCase()),
  purpose: z.string().optional(),
});

export const verifyOtpSchema = z.object({
  identifier: z.string().min(1, "Email or mobile number is required").transform((e) => e.toLowerCase()),
  code: z.string().length(6, "OTP must be 6 digits"),
  purpose: z.string().optional(),
});

export const registerOtpSchema = z.object({
  identifier: z.string().min(1, "Email or mobile number is required").transform((e) => e.toLowerCase()),
  name: z.string().min(1, "Name is required").max(100),
  role: RoleEnum.optional().default("Guest"),
});

export const googleLoginSchema = z.object({
  email: z.string().email("Invalid email").transform((e) => e.toLowerCase()),
  name: z.string().min(1, "Name is required"),
  googleId: z.string().optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email("Invalid email").transform((e) => e.toLowerCase()).optional(),
  phone: z.string().optional(),
  website: z.string().url().optional().or(z.literal("")),
  avatar: z.string().optional(),
  gender: z.string().optional().nullable(),
  bio: z.string().optional().nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export const submitKycSchema = z.object({
  panNumber: z.string().min(1, "PAN number is required"),
  bankAccount: z.string().min(1, "Bank account number is required"),
  bankIFSC: z.string().min(1, "Bank IFSC code is required"),
  gstin: z.string().optional(),
});

//   Admin  
export const adminLoginSchema = z.object({
  email: z.string().email("Invalid email").transform((e) => e.toLowerCase()),
  password: z.string().min(1, "Password is required"),
});

export const approvalNoteSchema = z.object({
  adminNote: z.string().optional(),
});

export const changeStatusSchema = z.object({
  status: ListingStatusEnum,
  adminNotes: z.string().optional(),
});

export const updateWalletSchema = z.object({
  amount: z.number(),
  operation: z.enum(["add", "subtract", "set"]),
});

export const testimonialCreateSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(100),
  text: z.string().min(1).max(1000),
  image: z.string().optional(),
  order: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const testimonialUpdateSchema = testimonialCreateSchema.partial();

//   Destination  
export const createDestinationSchema = z.object({
  name: z.string().min(1).max(200),
  state: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  image: z.string().url(),
  category: DestinationCategoryEnum,
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  description: z.string().optional().default(""),
});

export const updateDestinationSchema = createDestinationSchema.partial().extend({
  isActive: z.boolean().optional(),
  popularityScore: z.number().optional(),
});

//   Listing  
export const createListingSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1),
  summary: z.string().min(1).max(500),
  propertyType: PropertyTypeEnum,
  isEntirePlace: z.boolean().optional().default(true),
  floorNumber: z.number().int().optional(),
  totalFloors: z.number().int().optional(),
  propertySizeSqFt: z.number().int().optional(),
  yearBuilt: z.number().int().optional(),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().optional().default("India"),
  zipCode: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
  landmark: z.string().optional(),
  maxGuests: z.number().int().min(1),
  bedrooms: z.number().int().min(0),
  beds: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  extraMattresses: z.number().int().optional().default(0),
  basePrice: z.number().min(0),
  weekendPrice: z.number().min(0).optional(),
  seasonalPrices: z.array(z.object({
    seasonName: z.string().optional(),
    from: z.string(),
    to: z.string(),
    price: z.number().min(0),
  })).optional(),
  cleaningFee: z.number().min(0).optional().default(0),
  securityDeposit: z.number().min(0).optional().default(0),
  extraGuestPrice: z.number().min(0).optional().default(0),
  taxes: z.number().min(0).optional().default(0),
  minStay: z.number().int().min(1).optional().default(1),
  maxStay: z.number().int().optional().default(0),
  checkInTime: z.string().optional().default("12:00 PM"),
  checkOutTime: z.string().optional().default("11:00 AM"),
  flexibleCheckIn: z.boolean().optional().default(false),
  flexibleCheckOut: z.boolean().optional().default(false),
  amenities: z.array(z.string()).optional().default([]),
  meals: z.array(z.object({
    type: z.string(),
    available: z.boolean(),
    price: z.number().optional(),
    description: z.string().optional(),
  })).optional(),
  hasKitchen: z.boolean().optional().default(false),
  kitchenDetails: z.string().optional(),
  houseRules: z.array(z.object({
    rule: z.string(),
    icon: z.string().optional(),
  })).optional(),
  cancellationPolicy: CancellationPolicyEnum.optional().default("Moderate"),
  cancellationDetails: z.string().optional(),
  isPetFriendly: z.boolean().optional().default(false),
  petRules: z.string().optional(),
  isSmokingAllowed: z.boolean().optional().default(false),
  isPartyAllowed: z.boolean().optional().default(false),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  nearbyPlaces: z.array(z.object({
    name: z.string(),
    type: z.string(),
    distance: z.number(),
    icon: z.string().optional(),
  })).optional(),
  videoTourUrl: z.string().url().optional().or(z.literal("")),
  instantBook: z.boolean().optional().default(true),
  advanceNoticeHours: z.number().int().optional().default(0),
  maxGuestsPerBooking: z.number().int().optional(),
  languagesSpoken: z.array(z.string()).optional().default([]),
});

export const updateListingSchema = createListingSchema.partial();

//   Activity  
export const createActivitySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1),
  summary: z.string().min(1).max(500),
  activityType: ActivityTypeEnum,
  difficulty: DifficultyEnum,
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().optional().default("India"),
  zipCode: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
  landmark: z.string().optional(),
  meetingPoint: z.string().optional(),
  durationHours: z.number().min(0),
  durationDays: z.number().optional().default(0),
  startTimes: z.array(z.string()).optional().default([]),
  availability: z.string().optional().default("Daily"),
  availabilityNotes: z.string().optional(),
  minAge: z.number().int().optional().default(0),
  maxGroupSize: z.number().int().min(1),
  minGroupSize: z.number().int().optional().default(1),
  basePrice: z.number().min(0),
  weekendPrice: z.number().min(0).optional(),
  childPrice: z.number().min(0).optional(),
  foreignerPrice: z.number().min(0).optional(),
  seasonalPrices: z.array(z.object({
    seasonName: z.string().optional(),
    from: z.string(),
    to: z.string(),
    price: z.number().min(0),
  })).optional(),
  taxes: z.number().min(0).optional().default(0),
  securityDeposit: z.number().min(0).optional().default(0),
  equipmentProvided: z.array(z.string()).optional().default([]),
  equipmentRequired: z.array(z.string()).optional().default([]),
  safetyGuidelines: z.string().optional(),
  hasInsurance: z.boolean().optional().default(false),
  certifiedGuides: z.boolean().optional().default(false),
  guideRatio: z.string().optional(),
  included: z.array(z.string()).optional().default([]),
  excluded: z.array(z.string()).optional().default([]),
  houseRules: z.array(z.object({
    rule: z.string(),
    icon: z.string().optional(),
  })).optional(),
  cancellationPolicy: CancellationPolicyEnum.optional().default("Moderate"),
  cancellationDetails: z.string().optional(),
  isPetFriendly: z.boolean().optional().default(false),
  petRules: z.string().optional(),
  restrictions: z.string().optional(),
  nearbyPlaces: z.array(z.object({
    name: z.string(),
    type: z.string(),
    distance: z.number(),
    icon: z.string().optional(),
  })).optional(),
  videoTourUrl: z.string().url().optional().or(z.literal("")),
  instantBook: z.boolean().optional().default(true),
  advanceNoticeHours: z.number().int().optional().default(0),
  maxGuestsPerBooking: z.number().int().optional(),
  languagesSpoken: z.array(z.string()).optional().default([]),
});

export const updateActivitySchema = createActivitySchema.partial();

//   Chat  
export const getOrCreateConversationSchema = z.object({
  participantId: z.string().min(1),
  listingId: z.string().optional(),
  activityId: z.string().optional(),
  bookingTitle: z.string().optional(),
  bookingDateRange: z.string().optional(),
  bookingType: z.string().optional(),
});

export const sendMessageSchema = z.object({
  text: z.string().optional(),
  type: MessageTypeEnum.optional().default("text"),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
});

//   Availability  
export const blockDatesSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD format")).min(1),
  notes: z.string().optional(),
});

export const unblockDatesSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD format")).min(1),
});

export const bulkBlockSchema = z.object({
  action: z.enum(["all-weekends", "all-weekdays", "full-month", "date-range"]),
  year: z.number().int().optional(),
  month: z.number().int().min(0).max(11).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

//   Wishlist  
export const toggleWishlistSchema = z.object({
  itemId: z.string().min(1),
  itemType: WishlistItemTypeEnum,
});

export const checkWishlistSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().min(1),
    itemType: WishlistItemTypeEnum,
  })).min(1),
});

//   Upload
export const uploadDocumentSchema = z.object({
  documentType: z.enum(["aadharFront", "aadharBack", "panCardImage"]),
});

// ─────────────────────────────────────────────────────────────
//   Booking
// ─────────────────────────────────────────────────────────────
export const BookingItemTypeEnum = z.enum(["listing", "activity"]);
export const BookingTypeEnum = z.enum(["instant", "request"]);

export const createBookingSchema = z.object({
  itemId: z.string().min(1, "Item ID is required"),
  itemType: BookingItemTypeEnum,
  checkIn: z.string().datetime().optional(),
  checkOut: z.string().datetime().optional(),
  activityDate: z.string().datetime().optional(),
  startTime: z.string().optional(),
  guests: z.number().int().min(1, "At least 1 guest required"),
  adults: z.number().int().min(0).optional(),
  children: z.number().int().min(0).optional(),
  guestName: z.string().max(100).optional(),
  guestEmail: z.string().email().optional().or(z.literal("")),
  guestPhone: z.string().optional(),
  specialRequests: z.string().max(1000).optional(),
  couponCode: z.string().max(50).optional(),
  bookingType: BookingTypeEnum.optional().default("instant"),
}).refine(
  (data) => {
    if (data.itemType === "listing") {
      return !!data.checkIn && !!data.checkOut;
    }
    if (data.itemType === "activity") {
      return !!data.activityDate;
    }
    return true;
  },
  { message: "checkIn and checkOut are required for listings; activityDate is required for activities" },
);

export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const rejectBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const bookingPreviewSchema = z.object({
  itemId: z.string().min(1, "Item ID is required"),
  itemType: BookingItemTypeEnum,
  checkIn: z.string().datetime().optional(),
  checkOut: z.string().datetime().optional(),
  guests: z.number().int().min(1, "At least 1 guest required"),
  couponCode: z.string().max(50).optional(),
});

// ─────────────────────────────────────────────────────────────
//   Payment
// ─────────────────────────────────────────────────────────────
export const createRazorpayOrderSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
});

export const verifyRazorpayPaymentSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  razorpayOrderId: z.string().min(1, "Razorpay order ID is required"),
  razorpayPaymentId: z.string().min(1, "Razorpay payment ID is required"),
  razorpaySignature: z.string().min(1, "Razorpay signature is required"),
});

// ─── PayU ───
export const createPayuOrderSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
});

export const verifyPayuPaymentSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  txnid: z.string().min(1, "Transaction ID is required"),
  mihpayid: z.string().min(1, "PayU payment ID is required"),
  hash: z.string().min(1, "Hash is required"),
  status: z.string().min(1, "Status is required"),
  // Optional fields returned by PayU
  mode: z.string().optional(),
  amount: z.string().optional(),
  discount: z.string().optional(),
  productinfo: z.string().optional(),
  firstname: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  field1: z.string().optional(),
  field2: z.string().optional(),
  field3: z.string().optional(),
  field4: z.string().optional(),
  field5: z.string().optional(),
  field6: z.string().optional(),
  field7: z.string().optional(),
  field8: z.string().optional(),
  field9: z.string().optional(),
  error: z.string().optional(),
  error_Message: z.string().optional(),
  bank_ref_num: z.string().optional(),
  bankcode: z.string().optional(),
  cardnum: z.string().optional(),
  cardhash: z.string().optional(),
  udf1: z.string().optional(),
  udf2: z.string().optional(),
  udf3: z.string().optional(),
  udf4: z.string().optional(),
  udf5: z.string().optional(),
  udf6: z.string().optional(),
  udf7: z.string().optional(),
  udf8: z.string().optional(),
  udf9: z.string().optional(),
  udf10: z.string().optional(),
  addedon: z.string().optional(),
  unmappedstatus: z.string().optional(),
  payuMoneyId: z.string().optional(),
});

export const processRefundSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  amount: z.number().min(0, "Amount must be non-negative"),
  reason: z.string().max(500).optional(),
});

// ─────────────────────────────────────────────────────────────
//   Coupon
// ─────────────────────────────────────────────────────────────
export const CouponTypeEnum = z.enum(["percentage", "flat"]);
export const CouponScopeEnum = z.enum(["all", "stay", "activity"]);

export const createCouponSchema = z.object({
  code: z.string().min(1, "Coupon code is required").max(50).transform((c) => c.toUpperCase()),
  description: z.string().max(500).optional(),
  type: CouponTypeEnum,
  value: z.number().min(0, "Value must be non-negative"),
  maxDiscount: z.number().min(0).optional(),
  minOrderValue: z.number().min(0).optional().default(0),
  scope: CouponScopeEnum,
  itemId: z.string().optional(),
  usageLimit: z.number().int().min(0).optional().default(0),
  perUserLimit: z.number().int().min(1).optional().default(1),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
  isActive: z.boolean().optional().default(true),
});

export const updateCouponSchema = createCouponSchema.partial();

export const validateCouponSchema = z.object({
  code: z.string().min(1, "Coupon code is required"),
  orderValue: z.number().min(0, "Order value must be non-negative"),
  itemType: BookingItemTypeEnum,
  itemId: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────
//   Commission / Payout
// ─────────────────────────────────────────────────────────────
export const processPayoutSchema = z.object({
  hostId: z.string().min(1, "Host ID is required"),
  bookingIds: z.array(z.string().min(1)).min(1, "At least one booking ID is required"),
});

// ─────────────────────────────────────────────────────────────
//   Password Reset
// ─────────────────────────────────────────────────────────────
export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email").transform((e) => e.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// ─────────────────────────────────────────────────────────────
//   Dispute
// ─────────────────────────────────────────────────────────────
export const DisputeReasonEnum = z.enum([
  "payment_issue",
  "host_cancellation",
  "guest_cancellation",
  "item_not_as_described",
  "safety_concern",
  "other",
]);

export const createDisputeSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  reason: DisputeReasonEnum,
  description: z.string().min(10, "Description must be at least 10 characters").max(2000),
  evidenceUrls: z.array(z.string().url()).optional().default([]),
});

export const updateDisputeStatusSchema = z.object({
  status: z.enum(["open", "under_review", "resolved", "rejected"]),
  resolution: z.string().max(2000).optional(),
  refundAmount: z.number().min(0).optional(),
  adminNotes: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────
//   Campaign
// ─────────────────────────────────────────────────────────────
export const CampaignTypeEnum = z.enum(["email", "whatsapp", "push", "multi"]);
export const CampaignStatusEnum = z.enum(["draft", "scheduled", "running", "completed", "paused"]);

export const createCampaignSchema = z.object({
  name: z.string().min(1, "Campaign name is required").max(200),
  type: CampaignTypeEnum,
  subject: z.string().max(200).optional(),
  content: z.string().min(1, "Content is required"),
  htmlContent: z.string().optional(),
  targetSegment: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  status: CampaignStatusEnum.optional().default("draft"),
});

export const updateCampaignSchema = createCampaignSchema.partial();

// ─────────────────────────────────────────────────────────────
//   Configuration (admin)
// ─────────────────────────────────────────────────────────────
export const updateConfigurationSchema = z.object({
  key: z.string().min(1, "Configuration key is required"),
  value: z.any(),
  category: z.string().optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────
//   Review
// ─────────────────────────────────────────────────────────────
export const createReviewSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  rating: z.number().int().min(1, "Rating must be at least 1").max(5, "Rating must be at most 5"),
  title: z.string().max(200).optional(),
  comment: z.string().max(2000).optional(),
});

export const updateReviewSchema = z.object({
  rating: z.number().int().min(1, "Rating must be at least 1").max(5, "Rating must be at most 5").optional(),
  title: z.string().max(200).optional(),
  comment: z.string().max(2000).optional(),
});

export const replyToReviewSchema = z.object({
  reply: z.string().min(1, "Reply is required").max(2000, "Reply must be at most 2000 characters"),
});

// ─────────────────────────────────────────────────────────────
//   FCM Token Registration
// ─────────────────────────────────────────────────────────────
export const registerFcmTokenSchema = z.object({
  token: z.string().min(1, "FCM token is required"),
  deviceType: z.enum(["web", "android", "ios"]).optional(),
  deviceId: z.string().optional(),
});

//   Combine all schemas into a namespace-like export
export const schemas = {
  auth: {
    signup: signupSchema,
    login: loginSchema,
    sendOtp: sendOtpSchema,
    verifyOtp: verifyOtpSchema,
    registerOtp: registerOtpSchema,
    googleLogin: googleLoginSchema,
    updateProfile: updateProfileSchema,
    changePassword: changePasswordSchema,
    submitKyc: submitKycSchema,
  },
  admin: {
    login: adminLoginSchema,
    approvalNote: approvalNoteSchema,
    changeStatus: changeStatusSchema,
    updateWallet: updateWalletSchema,
    testimonialCreate: testimonialCreateSchema,
    testimonialUpdate: testimonialUpdateSchema,
  },
  destination: {
    create: createDestinationSchema,
    update: updateDestinationSchema,
  },
  listing: {
    create: createListingSchema,
    update: updateListingSchema,
  },
  activity: {
    create: createActivitySchema,
    update: updateActivitySchema,
  },
  chat: {
    getOrCreateConversation: getOrCreateConversationSchema,
    sendMessage: sendMessageSchema,
  },
  availability: {
    blockDates: blockDatesSchema,
    unblockDates: unblockDatesSchema,
    bulkBlock: bulkBlockSchema,
  },
  wishlist: {
    toggle: toggleWishlistSchema,
    check: checkWishlistSchema,
  },
  upload: {
    document: uploadDocumentSchema,
  },
  booking: {
    create: createBookingSchema,
    cancel: cancelBookingSchema,
    reject: rejectBookingSchema,
    preview: bookingPreviewSchema,
  },
  payment: {
    createRazorpayOrder: createRazorpayOrderSchema,
    verifyRazorpayPayment: verifyRazorpayPaymentSchema,
    createPayuOrder: createPayuOrderSchema,
    verifyPayuPayment: verifyPayuPaymentSchema,
    processRefund: processRefundSchema,
  },
  coupon: {
    create: createCouponSchema,
    update: updateCouponSchema,
    validate: validateCouponSchema,
  },
  commission: {
    processPayout: processPayoutSchema,
  },
  passwordReset: {
    forgot: forgotPasswordSchema,
    reset: resetPasswordSchema,
  },
  dispute: {
    create: createDisputeSchema,
    updateStatus: updateDisputeStatusSchema,
  },
  campaign: {
    create: createCampaignSchema,
    update: updateCampaignSchema,
  },
  configuration: {
    update: updateConfigurationSchema,
  },
  review: {
    create: createReviewSchema,
    update: updateReviewSchema,
    reply: replyToReviewSchema,
  },
  push: {
    registerToken: registerFcmTokenSchema,
  },
} as const;