export function createPhysicalReadGate(): Readonly<{
  run<T>(read: () => Promise<T>): Promise<T> | null;
  isBusy(): boolean;
}>;
export const PRIMARY_ROSTER_FRESH_MS: number;
export function isPrimaryRosterFresh(expiresAt: number | null, now?: number): boolean;
export function primaryChatActivity(actor: { state: string; recovery_required?: boolean }, state: string,
  expiresAt: number | null, now?: number): { label: string; tone: string };
