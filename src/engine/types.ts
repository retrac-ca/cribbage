export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export type Suit = (typeof SUITS)[number];
export type Difficulty = "easy" | "medium" | "hard";
export type Phase = "discard" | "pegging" | "show" | "complete";

export interface Card { id: string; rank: number; suit: Suit }
export interface Player { id: string; kind: "human" | "computer"; name: string }
export interface ScoreEvent { player: number; points: number; reason: string; cards?: Card[] }
export interface GameState {
  id: string;
  revision: number;
  phase: Phase;
  difficulty: Difficulty;
  players: [Player, Player];
  scores: [number, number];
  dealer: number;
  hands: [Card[], Card[]];
  showHands: [Card[], Card[]];
  crib: Card[];
  starter: Card | null;
  deck: Card[];
  discarded: [boolean, boolean];
  count: number;
  sequence: Card[];
  lastPlayer: number | null;
  passed: [boolean, boolean];
  turn: number;
  round: number;
  winner: number | null;
  events: ScoreEvent[];
  updatedAt: string;
}

export interface ScoreBreakdown { points: number; fifteens: number; pairs: number; runs: number; flush: number; nobs: number }
