import dotenv from "dotenv";
dotenv.config();

export const config = {
  nodeEnv: (process.env.NODE_ENV as "development" | "production" | "test") || "development",
  port: parseInt(process.env.PORT || "5000", 10),

  jwt: {
    secret: process.env.JWT_SECRET || "super_secret_triptay_key_2026",
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  },

  admin: {
    email: process.env.ADMIN_EMAIL || "admin@triptay.com",
    password: process.env.ADMIN_PASSWORD || "admin_triptay_2026_pass",
    name: process.env.ADMIN_NAME || "Aqib Khan",
  },

  cors: {
    allowedOrigins: [
      process.env.CLIENT_URL,
      "http://localhost:3000",
      "http://192.168.31.191:3000",
      "http://localhost:3001",
      "https://triptay-eight.vercel.app",
      "https://triptay.vercel.app",
      "https://triptaybackend.onrender.com",
    ].filter(Boolean) as string[],
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },

  rateLimit: {
    auth: { windowMs: 15 * 60 * 1000, max: (process.env.NODE_ENV || "development") === "development" ? 99999 : 30 },
    global: { windowMs: 15 * 60 * 1000, max: (process.env.NODE_ENV || "development") === "development" ? 99999 : 500 },
  },

  upload: {
    maxFileSize: 10 * 1024 * 1024,   // 10 MB
    maxDocSize: 5 * 1024 * 1024,     // 5 MB
    maxFiles: 5,
    allowedImageTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedDocTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  },

  pagination: {
    defaultLimit: 12,
    maxLimit: 100,
  },

  // ─── AWS S3 ───
  aws: {
    region: process.env.AWS_REGION || "ap-south-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    s3: {
      bucket: process.env.AWS_S3_BUCKET || "triptay-media",
      publicUrl: process.env.AWS_S3_PUBLIC_URL || "", // CDN/CloudFront URL if available
    },
  },

  // ─── AWS SES (Email) ───
  ses: {
    region: process.env.AWS_SES_REGION || process.env.AWS_REGION || "ap-south-1",
    fromEmail: process.env.SES_FROM_EMAIL || "no-reply@triptay.com",
    fromName: process.env.SES_FROM_NAME || "Triptay",
    configurationSet: process.env.SES_CONFIGURATION_SET || "",
  },

  // ─── AWS SNS (WhatsApp / SMS webhooks) ───
  sns: {
    region: process.env.AWS_SNS_REGION || process.env.AWS_REGION || "ap-south-1",
  },

  // ─── AWS SQS (Async job processing) ───
  sqs: {
    region: process.env.AWS_SQS_REGION || process.env.AWS_REGION || "ap-south-1",
    queueUrl: process.env.AWS_SQS_QUEUE_URL || "",
    enabled: process.env.SQS_ENABLED === "true",
  },

  // ─── Razorpay (Primary payment gateway for India) ───
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  },

  // ─── PayU (Secondary payment gateway for India) ───
  payu: {
    merchantId: process.env.PAYU_MERCHANT_ID || "",
    key: process.env.PAYU_KEY || "",
    salt: process.env.PAYU_SALT || "",
    webhookSalt: process.env.PAYU_WEBHOOK_SALT || "",
    // Test: https://test.payu.in  |  Production: https://secure.payu.in
    baseUrl: process.env.PAYU_BASE_URL || (process.env.NODE_ENV === "production" ? "https://secure.payu.in" : "https://test.payu.in"),
    // Payment Handle base (e.g. https://u.payu.in/WrmptyxGODNH)
    paymentHandleUrl: process.env.PAYU_PAYMENT_HANDLE_URL || "",
    env: (process.env.PAYU_ENV as "TEST" | "PRODUCTION") || (process.env.NODE_ENV === "production" ? "PRODUCTION" : "TEST"),
    successUrl: process.env.PAYU_SUCCESS_URL || `${process.env.FRONTEND_URL || "http://localhost:3000"}/checkout/payu/success`,
    failureUrl: process.env.PAYU_FAILURE_URL || `${process.env.FRONTEND_URL || "http://localhost:3000"}/checkout/payu/failure`,
  },

  // ─── Firebase (Push notifications) ───
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    databaseUrl: process.env.FIREBASE_DATABASE_URL || "",
  },

  // ─── WhatsApp Business API (Meta) ───
  whatsapp: {
    apiUrl: process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v18.0",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "triptay_verify",
  },

  // ─── Redis (Caching) ───
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
    ttl: parseInt(process.env.REDIS_TTL || "300", 10), // 5 minutes default
  },

  // ─── Commission defaults ───
  commission: {
    defaultRate: parseFloat(process.env.COMMISSION_RATE || "10"), // 10% default
    minPayoutAmount: parseFloat(process.env.MIN_PAYOUT_AMOUNT || "500"),
  },

  // ─── Security ───
  security: {
    otpExpiryMinutes: 5,
    otpMaxAttempts: 5,
    maxFailedLogins: 5,
    lockoutDurationMinutes: 30,
    passwordResetExpiryHours: 24,
    auditLogRetentionDays: 90,
  },

  // ─── App URLs ───
  app: {
    url: process.env.APP_URL || "https://triptay.com",
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
    adminUrl: process.env.ADMIN_URL || "http://localhost:3001",
  },

  isProduction: process.env.NODE_ENV === "production",
} as const;

export default config;
