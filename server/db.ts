import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

// Configure Neon for serverless environments
neonConfig.webSocketConstructor = ws;

// Add connection pooling configuration for better stability
neonConfig.poolQueryViaFetch = true;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// SQL 쿼리 로거 설정
const queryLogger = {
  logQuery: (query: string, params: any[]) => {
    // 쿼리 포맷팅 (인덴테이션 추가)
    const formattedQuery = query
      .replace(/\bselect\b/gi, '\nSELECT')
      .replace(/\bfrom\b/gi, '\nFROM')
      .replace(/\bwhere\b/gi, '\nWHERE')
      .replace(/\band\b/gi, '\n  AND')
      .replace(/\bor\b/gi, '\n  OR')
      .replace(/\binner join\b/gi, '\nINNER JOIN')
      .replace(/\bleft join\b/gi, '\nLEFT JOIN')
      .replace(/\bright join\b/gi, '\nRIGHT JOIN')
      .replace(/\binsert into\b/gi, '\nINSERT INTO')
      .replace(/\bvalues\b/gi, '\nVALUES')
      .replace(/\bupdate\b/gi, '\nUPDATE')
      .replace(/\bset\b/gi, '\nSET')
      .replace(/\bdelete from\b/gi, '\nDELETE FROM')
      .replace(/\border by\b/gi, '\nORDER BY')
      .replace(/\bgroup by\b/gi, '\nGROUP BY')
      .replace(/\bhaving\b/gi, '\nHAVING')
      .replace(/\blimit\b/gi, '\nLIMIT')
      .replace(/\boffset\b/gi, '\nOFFSET')
      .trim();

    // 파라미터를 바인딩한 쿼리 생성
    let boundQuery = formattedQuery;
    if (params && params.length > 0) {
      params.forEach((param, index) => {
        const placeholder = `$${index + 1}`;
        let value: string;
        
        if (param === null) {
          value = 'NULL';
        } else if (typeof param === 'string') {
          value = `'${param.replace(/'/g, "''")}'`;
        } else if (typeof param === 'number') {
          value = param.toString();
        } else if (typeof param === 'boolean') {
          value = param.toString();
        } else if (param instanceof Date) {
          value = `'${param.toISOString()}'`;
        } else {
          value = `'${JSON.stringify(param)}'`;
        }
        
        boundQuery = boundQuery.replace(new RegExp(`\\${placeholder}\\b`, 'g'), value);
      });
    }

    console.log(`\n[SQL QUERY]:\n${boundQuery}\n`);
    
    if (params && params.length > 0) {
      console.log(`[SQL PARAMS]: ${JSON.stringify(params)}`);
    }
  }
};

export const db = drizzle({ 
  client: pool, 
  schema,
  logger: queryLogger
});