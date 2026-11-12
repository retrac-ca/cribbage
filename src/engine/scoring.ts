import type { Card, ScoreBreakdown } from "./types";

export const pip = (card: Card) => Math.min(card.rank, 10);

export function scoreHand(hand: Card[], starter: Card, crib = false): ScoreBreakdown {
  if (hand.length !== 4) throw new Error("A cribbage hand must contain four cards");
  const cards = [...hand, starter];
  let fifteens = 0;
  for (let mask = 1; mask < 1 << cards.length; mask++) {
    let total = 0;
    for (let bit = 0; bit < cards.length; bit++) if (mask & (1 << bit)) total += pip(cards[bit]);
    if (total === 15) fifteens += 2;
  }
  const rankCounts = new Map<number, number>();
  for (const card of cards) rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
  let pairs = 0;
  for (const n of rankCounts.values()) pairs += (n * (n - 1) / 2) * 2;

  let runs = 0;
  const ranks = [...rankCounts.keys()].sort((a, b) => a - b);
  for (let start = 0; start < ranks.length;) {
    let end = start + 1;
    while (end < ranks.length && ranks[end] === ranks[end - 1] + 1) end++;
    const length = end - start;
    if (length >= 3) {
      let multiplicity = 1;
      for (let index = start; index < end; index++) multiplicity *= rankCounts.get(ranks[index])!;
      runs += length * multiplicity;
    }
    start = end;
  }

  const flush = hand.every(card => card.suit === hand[0].suit) && hand.length === 4
    ? (starter.suit === hand[0].suit ? 5 : crib ? 0 : 4)
    : 0;
  const nobs = hand.some(card => card.rank === 11 && card.suit === starter.suit) ? 1 : 0;
  return { points: fifteens + pairs + runs + flush + nobs, fifteens, pairs, runs, flush, nobs };
}

export function scorePegging(sequence: Card[], card: Card): { points: number; reasons: string[] } {
  const cards = [...sequence, card];
  const reasons: string[] = [];
  let points = 0;
  const total = cards.reduce((sum, current) => sum + pip(current), 0);
  if (total === 15) { points += 2; reasons.push("Fifteen"); }
  let sameRank = 1;
  for (let i = cards.length - 2; i >= 0 && cards[i].rank === card.rank; i--) sameRank++;
  if (sameRank >= 2) {
    const value = sameRank * (sameRank - 1);
    points += value;
    reasons.push(sameRank === 2 ? "Pair" : sameRank === 3 ? "Three of a kind" : "Four of a kind");
  }
  for (let length = cards.length; length >= 3; length--) {
    const suffix = cards.slice(-length);
    const ranks = suffix.map(item => item.rank).sort((a, b) => a - b);
    if (new Set(ranks).size === length && ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1)) {
      points += length;
      reasons.push(`${length}-card run`);
      break;
    }
  }
  if (total === 31) { points += 2; reasons.push("Thirty-one"); }
  return { points, reasons };
}
