import { ApiError } from '../data/source';

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 409 ? `${error.code}: ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
