import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db, Queryable } from "./db.js";
import { HttpError } from "./errors.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export type Role = "owner" | "viewer";
export type Principal = { kind: "user"; id: number; email: string; role: Role } | { kind: "agent"; name: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

// ---------- passwords ----------
// scrypt is a deliberately slow, memory-hard hash: cheap for one login, very expensive for
// someone trying billions of guesses against a stolen database. Built into Node, no native deps.
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16); // a new random salt per user: identical passwords get different hashes
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected); // compare in constant time
}

// A real hash of a random password, used when the email doesn't exist so a wrong email
// takes as long as a wrong password (no "this email exists" timing signal).
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

// ---------- tokens (sessions and API tokens) ----------
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createUser(db: Queryable, email: string, password: string, role: Role) {
  const { rows } = await db.query<{ id: number }>(
    "INSERT INTO users (email, password_hash, role) VALUES (lower($1), $2, $3) RETURNING id",
    [email, await hashPassword(password), role],
  );
  return rows[0].id;
}

/** Returns the plain token ONCE; only its hash is stored. */
export async function createApiToken(db: Queryable, name: string): Promise<string> {
  const token = `ct_${newToken()}`;
  await db.query("INSERT INTO api_tokens (name, token_hash) VALUES ($1, $2)", [name, sha256(token)]);
  return token;
}

const SESSION_DAYS = 14;
export const COOKIE = "sid";

/**
 * Reads who is calling, from either
 *  - "Authorization: Bearer ct_..." (the sync agent), or
 *  - the "sid" session cookie (a person in the browser).
 * Sets req.principal; does not reject anything by itself.
 */
export function loadPrincipal(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const bearer = req.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (bearer) {
      const { rows } = await db.query<{ name: string }>(
        "UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING name",
        [sha256(bearer)],
      );
      if (!rows[0]) throw new HttpError(401, "invalid API token");
      req.principal = { kind: "agent", name: rows[0].name };
      return next();
    }
    const sid = req.cookies?.[COOKIE];
    if (sid) {
      const { rows } = await db.query<{ id: number; email: string; role: Role }>(
        `SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [sha256(sid)],
      );
      if (rows[0]) req.principal = { kind: "user", ...rows[0] };
    }
    next();
  };
}

/** Any signed-in person (owner or viewer) may read. */
export const requireUser: RequestHandler = (req, _res, next) => {
  if (req.principal?.kind !== "user") throw new HttpError(401, "sign in first");
  next();
};

export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.principal?.kind !== "user") throw new HttpError(401, "sign in first");
  if (req.principal.role !== "owner") throw new HttpError(403, "viewers can only read");
  next();
};

export const requireAgent: RequestHandler = (req, _res, next) => {
  if (req.principal?.kind !== "agent") throw new HttpError(401, "API token required");
  next();
};

/**
 * CSRF guard. A malicious site can make the browser send a cross-site POST with our cookie,
 * but it cannot add a custom header without a CORS preflight, which we never allow.
 * So every cookie-authenticated write must carry X-Requested-With.
 * (SameSite=Lax on the cookie is a second layer.)
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (unsafe && req.principal?.kind !== "agent" && req.get("x-requested-with") !== "coop-tracker") {
    throw new HttpError(403, "missing X-Requested-With header");
  }
  next();
};

// ---------- login rate limit ----------
// In memory, per IP: 5 failures in 15 minutes locks that IP out until the window passes.
// Fine for one server instance; several instances would need a shared store (e.g. the database).
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, { n: number; since: number }>();
function tooManyFails(ip: string) {
  const f = fails.get(ip);
  if (f && Date.now() - f.since > WINDOW_MS) fails.delete(ip);
  return (fails.get(ip)?.n ?? 0) >= MAX_FAILS;
}
function recordFail(ip: string) {
  const f = fails.get(ip) ?? { n: 0, since: Date.now() };
  f.n += 1;
  fails.set(ip, f);
}
export const resetLoginLimits = () => fails.clear();

const loginBody = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export function authRouter(db: Db, opts: { secureCookies: boolean }): Router {
  const r = Router();

  r.post("/login", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (tooManyFails(ip)) throw new HttpError(429, "too many failed logins, try again later");
    const { email, password } = loginBody.parse(req.body);
    const { rows } = await db.query<{ id: number; email: string; role: Role; password_hash: string }>(
      "SELECT id, email, role, password_hash FROM users WHERE email = lower($1)",
      [email],
    );
    const user = rows[0];
    const ok = await verifyPassword(password, user?.password_hash ?? (await DUMMY_HASH));
    if (!user || !ok) {
      recordFail(ip);
      throw new HttpError(401, "wrong email or password"); // same message either way
    }
    fails.delete(ip);
    const token = newToken();
    await db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [sha256(token), user.id],
    );
    res.cookie(COOKIE, token, {
      httpOnly: true, // page JavaScript can't read it, so an XSS bug can't steal it
      secure: opts.secureCookies, // HTTPS only in production
      sameSite: "lax",
      maxAge: SESSION_DAYS * 86_400_000,
      path: "/",
    });
    res.json({ email: user.email, role: user.role });
  });

  r.post("/logout", async (req, res) => {
    const sid = req.cookies?.[COOKIE];
    if (sid) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(sid)]);
    res.clearCookie(COOKIE, { path: "/" });
    res.status(204).end();
  });

  r.get("/me", requireUser, (req, res) => {
    const p = req.principal as Extract<Principal, { kind: "user" }>;
    res.json({ email: p.email, role: p.role });
  });

  return r;
}
