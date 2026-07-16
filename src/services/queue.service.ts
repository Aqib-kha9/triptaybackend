import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";
import { sendEmail, emailTemplates } from "./email.service.js";
import { sendWhatsAppText } from "./whatsapp.service.js";
import { sendPushToUser } from "./push.service.js";

// ─── Types ───
export type JobType = "email" | "whatsapp" | "push" | "image_process" | "payout" | "custom";

export interface QueueJob {
  type: JobType;
  payload: Record<string, unknown>;
  priority?: number;
  delaySeconds?: number;
}

interface InMemoryJob extends QueueJob {
  id: string;
  attempts: number;
  createdAt: Date;
  availableAt: Date;
}

// ─── SQS Client ───
let sqsClient: SQSClient | null = null;

export function getSqsClient(): SQSClient | null {
  if (!config.sqs.enabled || !config.sqs.queueUrl) {
    return null;
  }
  if (!sqsClient) {
    sqsClient = new SQSClient({
      region: config.sqs.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }
  return sqsClient;
}

export function isSqsAvailable(): boolean {
  return config.sqs.enabled && !!config.sqs.queueUrl && !!getSqsClient();
}

// ─── In-Memory Queue Fallback ───
const inMemoryQueue: InMemoryJob[] = [];
const MAX_ATTEMPTS = 3;
let processorRunning = false;

// ─── Job Handlers ───
const jobHandlers: Record<JobType, (payload: Record<string, unknown>) => Promise<void>> = {
  email: async (payload) => {
    const { to, subject, html, template, templateData } = payload;
    if (template && templateData) {
      const templateFn = emailTemplates[template as string] as
        | ((data: Record<string, unknown>) => { subject: string; html: string; text: string })
        | undefined;
      if (templateFn) {
        const rendered = templateFn(templateData as Record<string, unknown>);
        await sendEmail(to as string, rendered.subject, rendered.html, rendered.text);
        return;
      }
    }
    await sendEmail(to as string, subject as string, html as string);
  },

  whatsapp: async (payload) => {
    const { to, body } = payload;
    await sendWhatsAppText({ to: to as string, body: body as string });
  },

  push: async (payload) => {
    const { userId, title, body, data } = payload;
    await sendPushToUser(userId as string, {
      title: title as string,
      body: body as string,
      data: data as Record<string, string> | undefined,
    });
  },

  image_process: async (payload) => {
    // Image processing is handled by upload.service.ts (Cloudinary transformations)
    // This is a placeholder for async image optimization jobs
    logger.info(`Image processing job: ${JSON.stringify(payload)}`);
  },

  payout: async (payload) => {
    // Payout processing is handled by commission.service.ts
    // This is a placeholder for async payout jobs (e.g., batch processing)
    logger.info(`Payout processing job: ${JSON.stringify(payload)}`);
  },

  custom: async (payload) => {
    logger.info(`Custom job: ${JSON.stringify(payload)}`);
  },
};

// ─── Enqueue a job ───
export async function enqueue(job: QueueJob): Promise<string | null> {
  // Try SQS first
  if (isSqsAvailable()) {
    try {
      const client = getSqsClient()!;
      const command = new SendMessageCommand({
        QueueUrl: config.sqs.queueUrl,
        MessageBody: JSON.stringify({
          type: job.type,
          payload: job.payload,
        }),
        DelaySeconds: job.delaySeconds || 0,
      });
      const result = await client.send(command);
      logger.info(`Job enqueued to SQS: ${job.type} (MessageId: ${result.MessageId})`);
      return result.MessageId || null;
    } catch (err) {
      logger.warn(`SQS enqueue failed, falling back to in-memory: ${(err as Error).message}`);
    }
  }

  // Fallback: in-memory queue
  const inMemoryJob: InMemoryJob = {
    ...job,
    id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    attempts: 0,
    createdAt: new Date(),
    availableAt: new Date(Date.now() + (job.delaySeconds || 0) * 1000),
  };
  inMemoryQueue.push(inMemoryJob);
  logger.info(`Job enqueued in-memory: ${job.type} (ID: ${inMemoryJob.id})`);

  // Start processor if not running
  if (!processorRunning) {
    startInMemoryProcessor().catch((err) => {
      logger.error("In-memory processor error:", err);
      processorRunning = false;
    });
  }

  return inMemoryJob.id;
}

// ─── Process a single job ───
async function processJob(job: InMemoryJob): Promise<boolean> {
  try {
    const handler = jobHandlers[job.type];
    if (!handler) {
      logger.error(`No handler for job type: ${job.type}`);
      return true; // Remove unprocessable jobs
    }

    await handler(job.payload);
    logger.info(`Job ${job.id} (${job.type}) processed successfully.`);
    return true;
  } catch (err) {
    job.attempts++;
    logger.warn(`Job ${job.id} (${job.type}) failed (attempt ${job.attempts}/${MAX_ATTEMPTS}): ${(err as Error).message}`);

    if (job.attempts >= MAX_ATTEMPTS) {
      logger.error(`Job ${job.id} (${job.type}) permanently failed after ${MAX_ATTEMPTS} attempts.`);
      return true; // Remove permanently failed jobs
    }

    // Re-queue with exponential backoff
    const backoffSeconds = Math.pow(2, job.attempts) * 5; // 10s, 20s, 40s
    job.availableAt = new Date(Date.now() + backoffSeconds * 1000);
    inMemoryQueue.push(job);
    return false;
  }
}

// ─── In-Memory Queue Processor ───
async function startInMemoryProcessor(): Promise<void> {
  processorRunning = true;
  logger.info("In-memory job processor started.");

  while (processorRunning) {
    const now = new Date();
    const readyJobs = inMemoryQueue.filter((j) => j.availableAt <= now);

    if (readyJobs.length === 0) {
      // No jobs ready, wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    // Process jobs sequentially (could be parallelized)
    for (const job of readyJobs) {
      // Remove from queue before processing
      const idx = inMemoryQueue.indexOf(job);
      if (idx > -1) inMemoryQueue.splice(idx, 1);

      const removed = await processJob(job);
      if (!removed) {
        // Job was re-queued with backoff, already pushed back in processJob
      }
    }
  }
}

// ─── SQS Consumer (for production with SQS) ───
export async function startSqsConsumer(): Promise<void> {
  if (!isSqsAvailable()) {
    logger.info("SQS not configured, using in-memory queue.");
    return;
  }

  logger.info("Starting SQS consumer...");

  const client = getSqsClient()!;

  const poll = async () => {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: config.sqs.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20, // Long polling
      });

      const result = await client.send(command);

      if (result.Messages && result.Messages.length > 0) {
        for (const message of result.Messages) {
          if (!message.Body || !message.ReceiptHandle) continue;

          try {
            const job = JSON.parse(message.Body) as { type: JobType; payload: Record<string, unknown> };
            const handler = jobHandlers[job.type];

            if (handler) {
              await handler(job.payload);
              logger.info(`SQS job processed: ${job.type}`);
            }

            // Delete message from queue
            await client.send(
              new DeleteMessageCommand({
                QueueUrl: config.sqs.queueUrl,
                ReceiptHandle: message.ReceiptHandle,
              }),
            );
          } catch (err) {
            logger.error(`SQS message processing failed: ${(err as Error).message}`);
            // Message will become visible again after visibility timeout
          }
        }
      }
    } catch (err) {
      logger.error(`SQS polling error: ${(err as Error).message}`);
    }

    // Continue polling
    setImmediate(poll);
  };

  poll();
}

// ─── Queue Statistics ───
export function getQueueStats() {
  return {
    sqsEnabled: isSqsAvailable(),
    inMemoryQueueSize: inMemoryQueue.length,
    processorRunning,
    pendingJobs: inMemoryQueue.filter((j) => j.availableAt > new Date()).length,
    readyJobs: inMemoryQueue.filter((j) => j.availableAt <= new Date()).length,
  };
}

// ─── Convenience: Enqueue email job ───
export async function enqueueEmail(to: string, subject: string, html: string): Promise<string | null> {
  return enqueue({
    type: "email",
    payload: { to, subject, html },
  });
}

// ─── Convenience: Enqueue WhatsApp job ───
export async function enqueueWhatsApp(to: string, body: string): Promise<string | null> {
  return enqueue({
    type: "whatsapp",
    payload: { to, body },
  });
}

// ─── Convenience: Enqueue push notification job ───
export async function enqueuePush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<string | null> {
  return enqueue({
    type: "push",
    payload: { userId, title, body, data },
  });
}
