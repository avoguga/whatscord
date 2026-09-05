import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { prisma } from "./prisma.js";

export type AccessClaims = { sub: string; username: string };

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"]
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "string") return null;
    if (!payload.sub || typeof payload.sub !== "string") return null;
    return { sub: payload.sub, username: String(payload.username ?? "") };
  } catch {
    return null;
  }
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Refresh tokens are random strings; only their hash is stored. */
export async function issueRefreshToken(userId: string, userAgent?: string) {
  const raw = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: sha256(raw), userAgent: userAgent?.slice(0, 250), expiresAt }
  });
  return { token: raw, expiresAt };
}

export async function rotateRefreshToken(raw: string, userAgent?: string) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true }
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) return null;

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() }
  });
  const next = await issueRefreshToken(record.userId, userAgent);
  return { user: record.user, refresh: next };
}

export async function revokeRefreshToken(raw: string) {
  await prisma.refreshToken
    .updateMany({
      where: { tokenHash: sha256(raw), revokedAt: null },
      data: { revokedAt: new Date() }
    })
    .catch(() => undefined);
}
