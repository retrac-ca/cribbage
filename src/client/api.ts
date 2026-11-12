export interface User {
  id: string; email: string; displayName: string; emailVerified: boolean;
  preferences: { sound?: boolean; showHints?: boolean }; createdAt: string;
}

export interface Card { id: string; rank: number; suit: "clubs" | "diamonds" | "hearts" | "spades" }
export interface Game {
  id: string; revision: number; phase: "discard" | "pegging" | "show" | "complete"; difficulty: "easy" | "medium" | "hard";
  players: [{ id: string; name: string }, { id: string; name: string }]; scores: [number, number]; dealer: number;
  hands: [Card[], Card[]]; computerCardCount: number; crib: Card[]; starter: Card | null; count: number;
  sequence: Card[]; turn: number; round: number; winner: number | null; events: { player: number; points: number; reason: string }[];
  legalCardIds: string[]; canSayGo: boolean; updatedAt: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options, credentials: "same-origin",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: string } };
  if (!response.ok) throw new ApiError(data.error?.message ?? "Something went wrong. Please try again.", response.status, data.error?.code ?? "ERROR");
  return data;
}

export const cardLabel = (rank: number) => rank === 1 ? "A" : rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : String(rank);
export const suitSymbol: Record<Card["suit"], string> = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
