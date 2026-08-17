/**
 * Mint a local-dev admin API key for the rbp Django app.
 *
 * The key is only ever shown here — Cal stores sha256(key), so a lost one is
 * unrecoverable and has to be replaced. Re-running replaces the previous
 * rbp-local-dev key rather than piling up rows.
 *
 * The owner must be role=ADMIN: IsSystemAdminGuard resolves the key to its user
 * and every /v2/users admin route checks that role.
 *
 *   yarn workspace @calcom/prisma exec ts-node --transpile-only ../../scripts/rbp-mint-dev-key.ts
 */
import { createHash, randomBytes } from "node:crypto";
import * as dotenv from "dotenv";

// Real environment wins; .env files only fill gaps (cwd is packages/prisma when
// run via yarn). Same order as rbp-setup.ts — without this the client falls back
// to localhost:5432 rather than whatever DATABASE_URL actually points at.
dotenv.config();
dotenv.config({ path: "../../.env" });

import { v4 } from "uuid";
import prisma from "@calcom/prisma";

const NOTE = "rbp-local-dev";

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true },
    orderBy: { id: "asc" },
  });
  if (!admin) {
    throw new Error("no role=ADMIN user exists — seed one before minting a key");
  }

  const removed = await prisma.apiKey.deleteMany({ where: { note: NOTE } });

  const key = randomBytes(16).toString("hex");
  const hashedKey = createHash("sha256").update(key).digest("hex");
  await prisma.apiKey.create({
    data: {
      id: v4(),
      userId: admin.id,
      note: NOTE,
      expiresAt: null, // dev key; expiry would just strand the local stack
      hashedKey,
    },
  });

  console.log(`owner: ${admin.email} (id ${admin.id}, role ADMIN)`);
  console.log(`replaced ${removed.count} previous ${NOTE} key(s)`);
  console.log(`KEY=${process.env.API_KEY_PREFIX ?? "cal_"}${key}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
