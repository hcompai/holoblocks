// Strip the chat, prompt and chat images from every public build, backing up the originals: node scripts/strip-public-chats.mjs <backup dir> [--apply]
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const apply = process.argv.includes("--apply");
const [target] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!target || !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("usage: BLOB_READ_WRITE_TOKEN=… node scripts/strip-public-chats.mjs <backup dir> [--apply]");
  process.exit(2);
}
const backups = resolve(target);
const dir = await mkdtemp(join(tmpdir(), "blockyard-chats-"));
try {
  const bundle = await rolldown({ input: "api/lib/store.ts", platform: "node", logLevel: "warn" });
  const file = join(dir, "strip.mjs");
  await bundle.write({ file, format: "esm", codeSplitting: false });
  await bundle.close();
  const { stripChats } = await import(pathToFileURL(file).href);
  const backup = async (path, data) => {
    const saved = join(backups, path);
    await mkdir(dirname(saved), { recursive: true });
    await writeFile(saved, data);
  };
  const { builds, chats, images } = await stripChats(backup, !apply);
  console.log(
    apply
      ? `Stripped ${chats} of ${builds} public builds and deleted ${images} chat images; originals are in ${backups}.`
      : `Would strip ${chats} of ${builds} public builds and delete ${images} chat images. Rerun with --apply.`,
  );
} catch {
  // Operator logs never carry SDK responses, user content or tokens.
  console.error("Stripping the public chats failed. Check store configuration and retry: a rerun finishes the job.");
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
