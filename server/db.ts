import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;

console.log(`[Database] Initializing - DATABASE_URL ${DATABASE_URL ? "is set" : "is NOT set"}`);

let sql: NeonQueryFunction<false, false>;

if (DATABASE_URL) {
  sql = neon(DATABASE_URL);
} else {
  console.error(
    "[Database] WARNING: DATABASE_URL is not set - database operations will fail"
  );
  sql = (async () => {
    throw new Error("DATABASE_URL environment variable is not configured");
  }) as unknown as NeonQueryFunction<false, false>;
}

export { sql };
