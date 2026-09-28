import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from package root or monorepo root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://kapibala:kapibala@localhost:5432/kapibala?schema=public',
  gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:4001',
  agentUrl: process.env.AGENT_URL || 'http://localhost:4002',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key-for-kapibala-auth-32bytes',
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || 'super-secret-refresh-key-for-kapibala-auth-32bytes',
  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
};
