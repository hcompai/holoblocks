import type { User } from "./account";
import { Refusal } from "./http";
import { privateConfigured, privateDelete, privateRead, privateWrite } from "./privateStore";
import { reauthor } from "./store";

const DOMAIN = "@hcompany.ai";
const ALLOWED = /^[\p{L}\p{M}\p{Nd} ._'-]{2,32}$/u;
const RESERVED = /h[\s._-]*company|holo/i;
const path = (owner: string) => `profiles/${encodeURIComponent(owner)}.json`;

const colleague = (email: string) => email.toLowerCase().endsWith(DOMAIN);
const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

/** The default public name for an email: "Jane Doe" at H Company, "Jane D." elsewhere, "" when it names nobody. */
export function nameOf(email: string): string {
  const words = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean);
  if (colleague(email)) return words.map(capital).join(" ");
  if (words.length < 2 || !words.every((w) => /^\p{L}+$/u.test(w))) return "";
  return `${capital(words[0])} ${words.at(-1)![0].toUpperCase()}.`;
}

/** The name on the user's public builds: the one they chose, else the default. */
export async function authorName(user: Pick<User, "id" | "email">): Promise<string> {
  const saved = privateConfigured() ? await privateRead(path(user.id)) : null;
  const { name } = saved ? ((await saved.json()) as { name?: unknown }) : {};
  return typeof name === "string" && name ? name : nameOf(user.email);
}

/** `given` as a display name for `email`'s owner, or "" to go back to the default. */
function checked(given: unknown, email: string): string {
  if (typeof given !== "string") throw new Refusal(400, "Send a name.");
  const name = given.trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (/@|:\/\/|www\./i.test(name)) throw new Refusal(400, "A display name can't hold an email address or a link.");
  if (!ALLOWED.test(name))
    throw new Refusal(400, "Use 2 to 32 letters, digits, spaces, dots, dashes, underscores or apostrophes.");
  if (!colleague(email) && RESERVED.test(name)) throw new Refusal(400, "That name is reserved for H Company.");
  return name;
}

/** Save the user's display name, "" for the default, and put it on every library build of theirs; returns it. */
export async function setAuthorName(user: Pick<User, "id" | "email">, given: unknown): Promise<string> {
  const name = checked(given, user.email);
  if (name) await privateWrite(path(user.id), JSON.stringify({ name }), "application/json");
  else if (privateConfigured()) await privateDelete([path(user.id)]);
  const author = name || nameOf(user.email);
  await reauthor(user.id, author);
  return author;
}
