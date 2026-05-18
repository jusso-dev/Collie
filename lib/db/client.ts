import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/collie";

const globalForDb = globalThis as unknown as {
  collieSql?: ReturnType<typeof postgres>;
};

export const sql = globalForDb.collieSql ?? postgres(connectionString, { prepare: false });

if (process.env.NODE_ENV !== "production") {
  globalForDb.collieSql = sql;
}

export const db = drizzle(sql, { schema });
export type Db = typeof db;
