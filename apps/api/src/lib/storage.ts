import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import crypto from "node:crypto";
import { env, storageEnabled } from "../env.js";

/**
 * Attachments live in MinIO. The bucket is never exposed publicly — the API
 * streams objects back through GET /files/:id, which keeps everything on one
 * HTTPS origin and avoids signed-URL expiry inside a long-lived desktop app.
 */
export const s3 = storageEnabled
  ? new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY!,
        secretAccessKey: env.S3_SECRET_KEY!
      }
    })
  : null;

export async function ensureBucket() {
  if (!s3) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
    console.log(`storage: created bucket ${env.S3_BUCKET}`);
  }
}

/** Object keys are opaque so a filename never has to be sanitised. */
export function newObjectKey(originalName: string) {
  const ext = originalName.includes(".") ? originalName.split(".").pop()!.slice(0, 12) : "bin";
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${crypto.randomUUID()}.${ext.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (!s3) throw new Error("Storage is not configured.");
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

export async function getObjectStream(key: string) {
  if (!s3) throw new Error("Storage is not configured.");
  const out = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return {
    body: out.Body as Readable,
    contentType: out.ContentType ?? "application/octet-stream",
    contentLength: out.ContentLength
  };
}

export async function deleteObject(key: string) {
  if (!s3) return;
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).catch(() => undefined);
}
