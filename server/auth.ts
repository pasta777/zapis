/* ────────────────────────────────────────────────────────────────
   Accounts.

   Zapis went multi-user so a leaderboard could exist. Nothing else
   about it became shared: the journals sit in one database but never
   in one query. Every route below establishes *who is asking*, and
   db.ts refuses to answer without that.

   Still no third-party credentials anywhere. Passwords are hashed
   locally with scrypt; sessions are opaque random tokens checked
   against a table, not signed blobs the client could tamper with.
   ──────────────────────────────────────────────────────────────── */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { userForSession, type DB, type User } from "./db.ts";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const SESSION_COOKIE = "zapis_session";
export const SESSION_TTL_DAYS = 30;

/* ── passwords ──────────────────────────────────────────────────── */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Constant-time password check.
 *
 * An empty stored hash means the account is locked rather than
 * password-less — that is the state a pre-accounts journal is adopted into,
 * and it must never be satisfiable by supplying an empty password.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;

  const actual = await scryptAsync(password, salt, KEY_LEN);
  return timingSafeEqual(actual, expected);
}

/** Rules kept deliberately mild: this is a journal, not a bank. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "password must be at least 8 characters";
  if (password.length > 200) return "password must be under 200 characters";
  return null;
}

export function handleProblem(handle: string): string | null {
  if (!/^[a-z0-9_-]{2,32}$/i.test(handle.trim())) {
    return "handle must be 2–32 characters, letters/numbers/dash/underscore only";
  }
  return null;
}

/* ── sessions ───────────────────────────────────────────────────── */

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Read the session cookie off the raw header.
 *
 * Parsed here rather than pulling in cookie-parser: the token is a random
 * 256-bit value validated against the sessions table, so there is no signature
 * to verify and nothing a cookie library would add.
 */
function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    return decodeURIComponent(part.slice(eq + 1).trim()) || null;
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_DAYS * 86_400_000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function sessionTokenOf(req: Request): string | null {
  return readSessionCookie(req);
}

/* ── middleware ─────────────────────────────────────────────────── */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** The current user, or null. Never throws — for optional-auth routes. */
export function currentUser(db: DB, req: Request): User | null {
  const token = readSessionCookie(req);
  if (!token) return null;
  return userForSession(db, token);
}

/**
 * Gate for everything that touches a journal.
 *
 * Attaches the resolved user to the request; handlers read `req.user!.id` and
 * pass it down. There is no ambient "current user" anywhere in the process,
 * which is what stops one request's identity leaking into another's.
 */
export function requireAuth(db: DB) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = currentUser(db, req);
    if (!user) {
      res.status(401).json({ error: "not signed in", detail: null });
      return;
    }
    req.user = user;
    next();
  };
}

/**
 * Registration gate.
 *
 * A deployment reachable from the internet with open sign-up is a public
 * diary host by accident. When ZAPIS_INVITE_CODE is unset registration is
 * refused outright rather than left open, so forgetting to configure it fails
 * closed.
 */
export function inviteProblem(supplied: string | undefined): string | null {
  const expected = process.env.ZAPIS_INVITE_CODE;
  if (!expected) return "registration is closed on this server";
  if (!supplied) return "an invite code is required";

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid invite code";
  return null;
}
