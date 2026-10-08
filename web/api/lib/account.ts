import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { bearer, Refusal } from "./http";

const DOMAIN = "@hcompany.ai";

export interface User {
  id: string;
  email: string;
  name: string;
}

const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

/** The name shown publicly for an email: "Jane Doe" at H Company, "Jane D." elsewhere, "" when it names nobody. */
export function nameOf(email: string): string {
  const words = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  if (email.toLowerCase().endsWith(DOMAIN)) return words.map(capital).join(" ");
  if (words.length < 2 || !words.every((w) => /^\p{L}+$/u.test(w))) return "";
  return `${capital(words[0])} ${words.at(-1)![0].toUpperCase()}.`;
}

export const admit = (user: { id: string; email: string }): User => ({ ...user, name: nameOf(user.email) });

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
