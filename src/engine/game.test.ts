import { describe, expect, it } from "vitest";
import { createDeck, createGame, discard, discardComputer, legalCards, playCard, sayGo, scoreShow, shuffleDeck, canSayGo } from "./game";
import { chooseDiscards, choosePeggingCard, runComputerTurn } from "./strategy";
import type { Card, GameState } from "./types";

const deck = createDeck();
function game(overrides: Partial<GameState> = {}): GameState {
  return { ...createGame({ deck: [...deck], dealer: 1 }), ...overrides, showHands: overrides.showHands ?? overrides.hands ?? [[], []] };
}

describe("game setup and discarding", () => {
  it("creates a full standard deck, deals six each, and leaves 40 cards", () => {
    const state = createGame({ deck: [...deck], dealer: 0 });
    expect(new Set(deck.map(card => card.id)).size).toBe(52);
    expect(state.hands.map(hand => hand.length)).toEqual([6, 6]);
    expect(state.deck).toHaveLength(40);
    expect(state.dealer).toBe(0);
  });
  it("shuffles every card without duplication", () => {
    const shuffled = shuffleDeck(() => 0.63);
    expect(new Set(shuffled.map(card => card.id)).size).toBe(52);
    expect(shuffled).not.toEqual(deck);
  });
  it("rejects illegal or foreign discards", () => {
    const state = game();
    expect(() => discard(state, 0, ["missing", "other"])).toThrow();
    expect(() => discard(state, 0, [state.hands[0][0].id])).toThrow();
  });
  it("puts four discards in the crib and turns the starter", () => {
    const state = game({ dealer: 0 });
    const human = state.hands[0].slice(0, 2).map(card => card.id);
    discard(state, 0, human);
    discardComputer(state, state.hands[1].slice(0, 2).map(card => card.id));
    expect(state.crib).toHaveLength(4);
    expect(state.hands.map(hand => hand.length)).toEqual([4, 4]);
    expect(state.starter).not.toBeNull();
    expect(state.phase).toBe("pegging");
    expect(state.turn).toBe(1);
  });
  it("awards his heels to the dealer for a jack starter", () => {
    const fixture = [...deck];
    // Starter is the next card after the twelve alternating dealt cards.
    fixture[12] = { id: "jack-hearts", rank: 11, suit: "hearts" };
    const state = createGame({ deck: fixture, dealer: 1 });
    discard(state, 0, state.hands[0].slice(0, 2).map(card => card.id));
    discardComputer(state, state.hands[1].slice(0, 2).map(card => card.id));
    expect(state.scores[1]).toBe(2);
    expect(state.events[0].reason).toBe("His heels");
  });
});

describe("pegging rules and game completion", () => {
  it("enforces the count and rejects cards that exceed 31", () => {
    const state = game({ phase: "pegging", turn: 0, count: 30, hands: [[{ id: "two", rank: 2, suit: "clubs" }], [{ id: "ace", rank: 1, suit: "hearts" }]] });
    expect(legalCards(state)).toHaveLength(0);
    expect(() => playCard(state, 0, "two")).toThrow();
  });
  it("awards 2 for thirty-one and resets the sequence", () => {
    const ten: Card = { id: "ten", rank: 10, suit: "clubs" };
    const state = game({ phase: "pegging", turn: 0, count: 21, sequence: [{ id: "a", rank: 10, suit: "hearts" }, { id: "b", rank: 10, suit: "diamonds" }, { id: "c", rank: 1, suit: "spades" }], hands: [[ten], [{ id: "other", rank: 2, suit: "hearts" }]], lastPlayer: 1 });
    playCard(state, 0, ten.id);
    expect(state.scores[0]).toBe(2);
    expect(state.count).toBe(0);
    expect(state.sequence).toHaveLength(0);
    expect(state.lastPlayer).toBeNull();
  });
  it("awards last card after go and does not score a second last card after 31", () => {
    const state = game({ phase: "pegging", turn: 0, count: 26, sequence: [{ id: "ten", rank: 10, suit: "clubs" }, { id: "ten2", rank: 10, suit: "hearts" }, { id: "six-sequence", rank: 6, suit: "spades" }], lastPlayer: 1, hands: [[{ id: "six", rank: 6, suit: "clubs" }], [{ id: "six2", rank: 6, suit: "hearts" }]] });
    sayGo(state, 0);
    expect(state.scores[1]).toBe(1);
    expect(state.count).toBe(0);
    expect(state.turn).toBe(1);
  });
  it("ends pegging only once both hands are exhausted", () => {
    const state = game({ phase: "pegging", count: 30, turn: 1, sequence: [{ id: "ten", rank: 10, suit: "clubs" }, { id: "ten2", rank: 10, suit: "hearts" }, { id: "ten3", rank: 10, suit: "spades" }], hands: [[], []], lastPlayer: 0 });
    sayGo(state, 1);
    expect(state.phase).toBe("show");
    expect(state.scores[0]).toBe(1);
  });
  it("ends the game immediately when pegging reaches 121", () => {
    const state = game({ phase: "pegging", turn: 0, scores: [119, 0], count: 10, sequence: [{ id: "ten", rank: 10, suit: "clubs" }], hands: [[{ id: "five", rank: 5, suit: "hearts" }], [{ id: "two", rank: 2, suit: "spades" }]] });
    playCard(state, 0, "five");
    expect(state.scores[0]).toBe(121);
    expect(state.phase).toBe("complete");
    expect(state.winner).toBe(0);
  });
  it("counts nondealer then dealer then crib, stopping at the winning hand", () => {
    const winningCards: Card[] = [
      { id: "5c", rank: 5, suit: "clubs" }, { id: "5d", rank: 5, suit: "diamonds" },
      { id: "5h", rank: 5, suit: "hearts" }, { id: "js", rank: 11, suit: "spades" },
    ];
    const state = game({ phase: "show", dealer: 1, scores: [120, 0], starter: { id: "5s", rank: 5, suit: "spades" }, hands: [winningCards, [{ id: "2c", rank: 2, suit: "clubs" }, { id: "3d", rank: 3, suit: "diamonds" }, { id: "7h", rank: 7, suit: "hearts" }, { id: "9s", rank: 9, suit: "spades" }]], crib: [] });
    scoreShow(state);
    expect(state.winner).toBe(0);
    expect(state.scores[0]).toBeGreaterThanOrEqual(121);
    expect(state.phase).toBe("complete");
    expect(state.dealer).toBe(1);
  });
  it("rotates the dealer after a hand and creates a fresh deal", () => {
    const state = game({ phase: "show", dealer: 1, starter: { id: "starter", rank: 6, suit: "clubs" }, hands: [[1, 2, 8, 12].map(rank => ({ id: `p-${rank}`, rank, suit: "clubs" as const })), [2, 4, 8, 13].map(rank => ({ id: `b-${rank}`, rank, suit: "hearts" as const }))], crib: [{ id: "c1", rank: 1, suit: "diamonds" }, { id: "c2", rank: 4, suit: "diamonds" }, { id: "c3", rank: 7, suit: "spades" }, { id: "c4", rank: 11, suit: "spades" }] });
    scoreShow(state, [...deck]);
    expect(state.dealer).toBe(0);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("discard");
    expect(state.hands.map(hand => hand.length)).toEqual([6, 6]);
  });
  it("computer strategy chooses two valid discards and only legal pegging cards", () => {
    const state = createGame({ deck: [...deck], dealer: 0, difficulty: "hard" });
    const ids = chooseDiscards(state, "hard", () => 0.37);
    expect(ids).toHaveLength(2);
    expect(ids.every(id => state.hands[1].some(card => card.id === id))).toBe(true);
    const pegging = game({ phase: "pegging", turn: 1, count: 10, sequence: [{ id: "played-ten", rank: 10, suit: "clubs" }], hands: [[{ id: "human-ace", rank: 1, suit: "hearts" }], [{ id: "bot-ace", rank: 1, suit: "spades" }, { id: "bot-king", rank: 13, suit: "clubs" }]] });
    const legal = legalCards(pegging, 1);
    const decision = choosePeggingCard(pegging.hands[1], legal, pegging.sequence, pegging.count, "hard");
    expect(legal.map(card => card.id)).toContain(decision);
    expect(() => playCard(pegging, 1, decision)).not.toThrow();
  });

  it("plays a complete deterministic game through repeated deals to 121", () => {
    let seed = 7381;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const state = createGame({ deck: shuffleDeck(random), dealer: 0, difficulty: "medium" });
    let actions = 0;
    while (state.phase !== "complete" && actions < 1600) {
      actions++;
      if (state.phase === "discard") {
        discard(state, 0, state.hands[0].slice(0, 2).map(card => card.id));
        discardComputer(state, chooseDiscards(state, state.difficulty, random));
        if ((state.phase as string) === "pegging") runComputerTurn(state);
      } else if (state.phase === "pegging") {
        if (state.turn === 1) runComputerTurn(state);
        else if (legalCards(state, 0).length) playCard(state, 0, legalCards(state, 0)[0].id);
        else { expect(canSayGo(state, 0)).toBe(true); sayGo(state, 0); runComputerTurn(state); }
      } else if (state.phase === "show") scoreShow(state, shuffleDeck(random));
    }
    expect(actions).toBeLessThan(1600);
    expect(state.phase).toBe("complete");
    expect([0, 1]).toContain(state.winner);
    expect(state.scores[state.winner!]).toBeGreaterThanOrEqual(121);
  }, 10_000);
});
