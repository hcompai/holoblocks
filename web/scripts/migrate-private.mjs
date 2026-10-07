// Move the private builds left in the public Blob store into the private one: node scripts/migrate-private.mjs [--dry-run]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const dryRun = process.argv.includes("--dry-run");
const dir = await mkdtemp(join(tmpdir(), "blockyard-private-"));
try {
  const bundle = await rolldown({ input: "api/lib/store.ts", platform: "node", logLevel: "warn" });
  const file = join(dir, "migrate.mjs");
  await bundle.write({ file, format: "esm", codeSplitting: false });
  await bundle.close();
  const { migratePrivate } = await import(pathToFileURL(file).href);
  const count = await migratePrivate(dryRun);
  console.log(dryRun ? `Would migrate ${count} private builds.` : `Migrated ${count} private builds.`);
} catch {
  // Operator logs never carry SDK responses, user content or tokens.
  console.error("Private migration failed. Check store configuration and retry.");
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
