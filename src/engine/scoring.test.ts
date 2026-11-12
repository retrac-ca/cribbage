import { describe, expect, it } from "vitest";
import { scoreHand, scorePegging } from "./scoring";
import type { Card, Suit } from "./types";

const card = (rank: number, suit: Suit = "clubs"): Card => ({ id: `${suit}-${rank}-${Math.random()}`, rank, suit });
const hand = (...ranks: number[]) => ranks.map((rank, index) => card(rank, (["clubs", "diamonds", "hearts", "spades"] as Suit[])[index % 4]));

describe("cribbage hand scoring", () => {
  it("counts multiple fifteen combinations", () => {
    const result = scoreHand(hand(5, 5, 10, 10), card(1, "hearts"));
    expect(result.fifteens).toBe(8); // each 5 pairs with each ten
  });

  it("scores a pair, two pairs, and three of a kind", () => {
    expect(scoreHand(hand(2, 2, 7, 9), card(12)).pairs).toBe(2);
    expect(scoreHand(hand(2, 2, 3, 3), card(9)).pairs).toBe(4);
    expect(scoreHand(hand(7, 7, 7, 12), card(2)).pairs).toBe(6);
    expect(scoreHand(hand(9, 9, 9, 9), card(1)).pairs).toBe(12);
  });

  it("scores runs of three, four, and five", () => {
    expect(scoreHand(hand(3, 4, 5, 11), card(13)).runs).toBe(3);
    expect(scoreHand(hand(3, 4, 5, 6), card(13)).runs).toBe(4);
    expect(scoreHand(hand(1, 2, 3, 4), card(5)).runs).toBe(5);
  });

  it("counts distinct duplicate-rank run combinations without shorter sub-runs", () => {
    expect(scoreHand(hand(3, 3, 4, 5), card(9)).runs).toBe(6);
    expect(scoreHand(hand(1, 2, 3, 4), card(5)).runs).toBe(5);
  });

  it("scores four-card and five-card flushes, respecting crib rules", () => {
    const four = [card(1, "hearts"), card(3, "hearts"), card(6, "hearts"), card(9, "hearts")];
    expect(scoreHand(four, card(13, "clubs")).flush).toBe(4);
    expect(scoreHand(four, card(13, "hearts")).flush).toBe(5);
    expect(scoreHand(four, card(13, "clubs"), true).flush).toBe(0);
    expect(scoreHand(four, card(13, "hearts"), true).flush).toBe(5);
    expect(scoreHand([card(1), card(3, "hearts"), card(6), card(9)], card(13)).flush).toBe(0);
  });

  it("scores nobs only for a jack matching the starter suit", () => {
    const cards = [card(1), card(4), card(9), card(11, "spades")];
    expect(scoreHand(cards, card(5, "spades")).nobs).toBe(1);
    expect(scoreHand(cards, card(5, "hearts")).nobs).toBe(0);
  });

  it("scores the classic 29 hand and combined categories correctly", () => {
    const hand29 = [card(5, "clubs"), card(5, "diamonds"), card(5, "hearts"), card(11, "spades")];
    const result = scoreHand(hand29, card(5, "spades"));
    expect(result).toEqual({ points: 29, fifteens: 16, pairs: 12, runs: 0, flush: 0, nobs: 1 });
  });

  it("does not score a five-card crib flush when one card differs", () => {
    const crib = [card(1, "diamonds"), card(3, "diamonds"), card(6, "diamonds"), card(9, "diamonds")];
    expect(scoreHand(crib, card(13, "clubs"), true).flush).toBe(0);
  });
});

describe("pegging scoring", () => {
  it("scores fifteen and thirty-one", () => {
    expect(scorePegging([card(10)], card(5)).reasons).toContain("Fifteen");
    expect(scorePegging([card(10), card(10), card(1)], card(10)).reasons).toContain("Thirty-one");
  });
  it("scores pairs, triples, and quadruples", () => {
    expect(scorePegging([card(6)], card(6)).points).toBe(2);
    expect(scorePegging([card(6), card(6)], card(6)).points).toBe(6);
    expect(scorePegging([card(6), card(6), card(6)], card(6)).points).toBe(12);
  });
  it("scores pegging runs in any play order and chooses the longest suffix", () => {
    expect(scorePegging([card(4), card(2)], card(3))).toEqual({ points: 3, reasons: ["3-card run"] });
    expect(scorePegging([card(2), card(4), card(3)], card(5)).points).toBe(4);
    expect(scorePegging([card(2), card(2), card(3)], card(4)).points).toBe(3);
  });
  it("does not count runs that contain duplicate ranks", () => {
    expect(scorePegging([card(2), card(3)], card(3)).points).toBe(2);
  });
});
