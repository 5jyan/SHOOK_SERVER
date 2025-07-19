import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// SQL 쿼리 로거 설정
const queryLogger = {
  logQuery: (query: string, params: any[]) => {
    console.log(`[SQL] ${query}`);
    if (params && params.length > 0) {
      console.log(`[SQL PARAMS] ${JSON.stringify(params)}`);
    }
  }
};

export const db = drizzle({ 
  client: pool, 
  schema,
  logger: queryLogger
});