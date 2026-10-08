import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { bearer, Refusal } from "./http";
import { authorName } from "./profile";

export interface User {
  id: string;
  email: string;
  name: string;
}

/** Any portal user, under their public name. */
export const admit = async (user: { id: string; email: string }): Promise<User> => ({
  ...user,
  name: await authorName(user),
});

export const isAdmin = (user: User) =>
  (process.env.BLOCKYARD_ADMINS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(user.email.toLowerCase());

function seal(payload: string): Buffer {
  const secret = process.env.BLOCKYARD_SECRET;
  if (!secret) throw new Error("BLOCKYARD_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest();
}

const digest = (key: string) => createHash("sha256").update(key).digest("base64url");

/** A pass naming the user to this API until `expires` (seconds), good only beside their Agents API `key`. */
export function pass(user: User, expires: number, key: string): string {
  const payload = Buffer.from(JSON.stringify({ ...user, expires, key: digest(key) })).toString("base64url");
  return `${payload}.${seal(payload).toString("base64url")}`;
}

/** The user whose pass the request carries, and their Agents API key, from `X-Agents-Key`. */
export function holder(request: Request): { user: User; key: string } {
  const [payload, signature] = (bearer(request) ?? "").split(".");
  const key = request.headers.get("x-agents-key");
  if (!payload || !signature || !key) throw new Refusal(401, "Sign in first.");
  const given = Buffer.from(signature, "base64url");
  const expected = seal(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Refusal(401, "Sign in again.");
  const { id, email, name, expires, key: sealed } = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (expires < Date.now() / 1000) throw new Refusal(401, "Your sign-in expired: sign in again.");
  if (sealed !== digest(key)) throw new Refusal(401, "Sign in again.");
  return { user: { id, email, name }, key };
}
