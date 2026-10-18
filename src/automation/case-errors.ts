/** Case failures we intentionally skip (not real account errors). */
export function isIgnorableCaseError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /energy points|energy case|case is locked/i.test(message);
}
