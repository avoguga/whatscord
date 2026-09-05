import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { env, s3Configured } from "../env.js";

/**
 * Attachments have two possible homes behind one interface.
 *
 * Default is a directory on a persistent volume next to the API. It has no
 * moving parts, no second container to keep alive and no service discovery to
 * get wrong — which matters, because MinIO on this host crash-looped without
 * writing a log, and Coolify 4.3.17 does not honour `connect_to_docker_network`
 * for compose services, so the API could not have resolved it regardless.
 *
 * Set the S3_* variables and it switches to S3 (MinIO, R2, anything
 * compatible). Downloads are proxied by the API either way, so nothing outside
 * this file knows which one is in use.
 */

export const driver: "s3" | "local" = s3Configured ? "s3" : "local";

const s3 = s3Configured
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

/** Resolves a key to a path inside UPLOAD_DIR, refusing anything that escapes it. */
function localPath(key: string) {
  const root = path.resolve(env.UPLOAD_DIR);
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("Bad file reference.");
  }
  return full;
}

export async function initStorage() {
  if (driver === "local") {
    await fs.mkdir(path.resolve(env.UPLOAD_DIR), { recursive: true });
    return;
  }
  try {
    await s3!.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3!.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}

/** Keys are opaque, so a filename never has to be sanitised or trusted. */
export function newObjectKey(originalName: string) {
  const raw = originalName.includes(".") ? originalName.split(".").pop()! : "bin";
  const ext = raw.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${crypto.randomUUID()}.${ext}`;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (driver === "local") {
    const full = localPath(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    await fs.writeFile(`${full}.type`, contentType, "utf8");
    return;
  }
  await s3!.send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType })
  );
}

export async function getObjectStream(key: string) {
  if (driver === "local") {
    const full = localPath(key);
    const stat = await fs.stat(full);
    const contentType = await fs
      .readFile(`${full}.type`, "utf8")
      .catch(() => "application/octet-stream");
    return {
      body: createReadStream(full) as Readable,
      contentType: contentType.trim(),
      contentLength: stat.size
    };
  }

  const out = await s3!.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return {
    body: out.Body as Readable,
    contentType: out.ContentType ?? "application/octet-stream",
    contentLength: out.ContentLength
  };
}

export async function deleteObject(key: string) {
  if (driver === "local") {
    const full = localPath(key);
    await fs.rm(full, { force: true }).catch(() => undefined);
    await fs.rm(`${full}.type`, { force: true }).catch(() => undefined);
    return;
  }
  await s3!
    .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    .catch(() => undefined);
}
