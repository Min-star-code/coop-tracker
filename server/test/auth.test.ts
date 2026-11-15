import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { hashPassword, verifyPassword } from "../auth.js";
import type { Db } from "../db.js";
import { login, OWNER, seed, setup, VIEWER } from "./helpers.js";

let db: Db;
let app: Awaited<ReturnType<typeof setup>>["app"];
const H = { "X-Requested-With": "coop-tracker" };

beforeEach(async () => {
  ({ db, app } = await setup());
});
afterEach(() => db.close());

describe("password hashing", () => {
  it("never stores the password and salts every hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toContain("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("other-password", a)).toBe(false);
  });
});

describe("login / logout", () => {
  it("sets an httpOnly SameSite cookie and /me returns the role", async () => {
    const res = await request(app).post("/api/auth/login").set(H).send(OWNER).expect(200);
    const cookie = res.headers["set-cookie"][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const agent = await login(app, OWNER);
    expect((await agent.get("/api/auth/me").expect(200)).body).toEqual({ email: OWNER.email, role: "owner" });
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const a = await request(app).post("/api/auth/login").set(H).send({ ...OWNER, password: "nope" }).expect(401);
    const b = await request(app).post("/api/auth/login").set(H).send({ email: "x@example.com", password: "nope" }).expect(401);
    expect(a.body).toEqual(b.body);
  });

  it("stores only a hash of the session token", async () => {
    const res = await request(app).post("/api/auth/login").set(H).send(OWNER).expect(200);
    const token = res.headers["set-cookie"][0].match(/sid=([^;]+)/)![1];
    const { rows } = await db.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
    expect(rows[0].token_hash).not.toBe(token);
  });

  it("logout ends the session on the server", async () => {
    const agent = await login(app, OWNER);
    await agent.post("/api/auth/logout").set(H).expect(204);
    await agent.get("/api/auth/me").expect(401);
    expect((await db.query("SELECT * FROM sessions")).rows).toHaveLength(0);
  });

  it("an expired session is refused", async () => {
    const agent = await login(app, OWNER);
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    await agent.get("/api/auth/me").expect(401);
  });

  it("locks an IP out after 5 failed logins", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").set(H).send({ ...OWNER, password: "wrong" }).expect(401);
    }
    await request(app).post("/api/auth/login").set(H).send(OWNER).expect(429);
  });
});

describe("roles", () => {
  it("anonymous users can't read anything", async () => {
    await request(app).get("/api/applications").expect(401);
    await request(app).get("/api/stats").expect(401);
  });

  it("a viewer can read but not edit", async () => {
    const [id] = await seed(db, [{}]);
    const viewer = await login(app, VIEWER);
    await viewer.get("/api/applications").expect(200);
    await viewer.get(`/api/applications/${id}`).expect(200);
    const res = await viewer.patch(`/api/applications/${id}`).set(H).send({ status: "Applied" }).expect(403);
    expect(res.body.error).toBe("viewers can only read");
  });

  it("the owner can edit", async () => {
    const [id] = await seed(db, [{}]);
    const owner = await login(app, OWNER);
    await owner.patch(`/api/applications/${id}`).set(H).send({ status: "Applied" }).expect(200);
  });
});

describe("CSRF guard", () => {
  it("refuses a cookie-authenticated write without X-Requested-With", async () => {
    const [id] = await seed(db, [{}]);
    const owner = await login(app, OWNER);
    await owner.patch(`/api/applications/${id}`).send({ status: "Applied" }).expect(403);
  });
});

describe("API token (sync agent)", () => {
  it("a person's cookie cannot call the sync endpoint", async () => {
    const owner = await login(app, OWNER);
    await owner.post("/api/sync").set(H).send({ applications: [] }).expect(401);
  });

  it("a wrong token is refused, and a token cannot read the site", async () => {
    await request(app).post("/api/sync").set("Authorization", "Bearer ct_wrong").send({ applications: [] }).expect(401);
    const { token } = await setup(); // a token from a different database
    await request(app).post("/api/sync").set("Authorization", `Bearer ${token}`).send({ applications: [] }).expect(401);
  });
});
