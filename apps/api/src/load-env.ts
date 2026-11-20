import dotenv from 'dotenv';

// Repo .env first, then the single shared workspace .env at the repository root (local dev only).
// Real environment variables (Vercel, GitHub Actions) always win: dotenv never overrides them.
dotenv.config();
dotenv.config({ path: '../../.env' });
