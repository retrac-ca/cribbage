import type { Card, Difficulty, GameState } from "./types";
import { SUITS } from "./types";
import { pip, scoreHand, scorePegging } from "./scoring";

export function createDeck(): Card[] {
  return SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}-${i + 1}`, rank: i + 1, suit })));
}

export function shuffleDeck(random: () => number = Math.random): Card[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createGame(options: { deck?: Card[]; dealer?: number; difficulty?: Difficulty; id?: string; now?: string } = {}): GameState {
  const deck = [...(options.deck ?? shuffleDeck())];
  if (deck.length !== 52) throw new Error("A new game requires a complete deck");
  const hands: [Card[], Card[]] = [[], []];
  for (let i = 0; i < 6; i++) { hands[0].push(deck.shift()!); hands[1].push(deck.shift()!); }
  return {
    id: options.id ?? crypto.randomUUID(), revision: 0, phase: "discard", difficulty: options.difficulty ?? "medium",
    players: [{ id: "human", kind: "human", name: "You" }, { id: "computer", kind: "computer", name: "Computer" }],
    scores: [0, 0], dealer: options.dealer ?? Math.floor(Math.random() * 2), hands, showHands: [[], []], crib: [], starter: null, deck,
    discarded: [false, false], count: 0, sequence: [], lastPlayer: null, passed: [false, false], turn: 0,
    round: 1, winner: null, events: [], updatedAt: options.now ?? new Date().toISOString(),
  };
}

function award(state: GameState, player: number, points: number, reason: string, cards?: Card[]) {
  if (points <= 0 || state.winner !== null) return;
  state.scores[player] += points;
  state.events.push({ player, points, reason, cards });
  if (state.scores[player] >= 121) { state.winner = player; state.phase = "complete"; }
}

function startPegging(state: GameState) {
  state.showHands = [[...state.hands[0]], [...state.hands[1]]];
  state.starter = state.deck.shift()!;
  state.phase = "pegging";
  state.count = 0; state.sequence = []; state.passed = [false, false]; state.lastPlayer = null;
  state.turn = 1 - state.dealer;
  if (state.starter.rank === 11) award(state, state.dealer, 2, "His heels");
}

export function discard(state: GameState, player: number, cardIds: string[]): GameState {
  if (state.phase !== "discard" || player !== 0 || state.discarded[player]) throw new Error("Discards are not allowed now");
  if (cardIds.length !== 2 || new Set(cardIds).size !== 2 || cardIds.some(id => !state.hands[player].some(card => card.id === id))) throw new Error("Choose two different cards from your hand");
  const removed = state.hands[player].filter(card => cardIds.includes(card.id));
  state.hands[player] = state.hands[player].filter(card => !cardIds.includes(card.id));
  state.crib.push(...removed); state.discarded[player] = true;
  return state;
}

export function discardComputer(state: GameState, cardIds: string[]): GameState {
  if (state.phase !== "discard" || state.discarded[1] || cardIds.length !== 2 || new Set(cardIds).size !== 2 || cardIds.some(id => !state.hands[1].some(card => card.id === id))) throw new Error("Invalid computer discard");
  const removed = state.hands[1].filter(card => cardIds.includes(card.id));
  state.hands[1] = state.hands[1].filter(card => !cardIds.includes(card.id));
  state.crib.push(...removed); state.discarded[1] = true;
  if (state.discarded[0]) startPegging(state);
  return state;
}

function finishSequence(state: GameState) {
  if (state.lastPlayer !== null && state.count !== 31) award(state, state.lastPlayer, 1, "Last card");
  if (state.winner !== null) return;
  state.count = 0; state.sequence = []; state.passed = [false, false];
  if (state.hands[0].length === 0 && state.hands[1].length === 0) { state.phase = "show"; return; }
  state.turn = state.lastPlayer ?? (1 - state.turn);
  state.lastPlayer = null;
  normalizeTurn(state);
}

function normalizeTurn(state: GameState) {
  if (state.phase !== "pegging" || state.winner !== null) return;
  const canPlay = (player: number) => !state.passed[player] && state.hands[player].some(card => state.count + pip(card) <= 31);
  for (let i = 0; i < 2; i++) {
    if (!canPlay(state.turn)) {
      state.passed[state.turn] = true;
      state.turn = 1 - state.turn;
    } else break;
  }
  if (!canPlay(0) && !canPlay(1)) finishSequence(state);
}

export function playCard(state: GameState, player: number, cardId: string): GameState {
  if (state.phase !== "pegging" || player !== state.turn || state.winner !== null) throw new Error("It is not your turn to play");
  const index = state.hands[player].findIndex(card => card.id === cardId);
  if (index < 0 || state.passed[player]) throw new Error("That card is not available");
  const [card] = state.hands[player].splice(index, 1);
  if (state.count + pip(card) > 31) { state.hands[player].push(card); throw new Error("That card would take the count over 31"); }
  const result = scorePegging(state.sequence, card);
  state.sequence.push(card); state.count += pip(card); state.lastPlayer = player;
  if (result.points) award(state, player, result.points, result.reasons.join(" + "), state.sequence.slice());
  if (state.winner !== null) return state;
  if (state.count === 31) {
    state.count = 0; state.sequence = []; state.passed = [false, false];
    if (state.hands[0].length === 0 && state.hands[1].length === 0) state.phase = "show";
    else { state.turn = player; state.lastPlayer = null; normalizeTurn(state); }
  } else { state.turn = 1 - player; normalizeTurn(state); }
  return state;
}

export function sayGo(state: GameState, player: number): GameState {
  if (state.phase !== "pegging" || player !== state.turn || state.winner !== null) throw new Error("It is not your turn to say go");
  if (state.hands[player].some(card => state.count + pip(card) <= 31)) throw new Error("You have a card you can play");
  state.passed[player] = true;
  if (state.passed[0] && state.passed[1]) finishSequence(state);
  else { state.turn = 1 - player; normalizeTurn(state); }
  return state;
}

export function scoreShow(state: GameState, nextDeck?: Card[]): GameState {
  if (state.phase !== "show" || !state.starter) throw new Error("The hand is not ready to score");
  const order = [1 - state.dealer, state.dealer];
  for (const player of order) {
    const result = scoreHand(state.showHands[player].length === 4 ? state.showHands[player] : state.hands[player], state.starter);
    const details = [
      result.fifteens ? `Fifteens ${result.fifteens}` : "",
      result.pairs ? `Pairs ${result.pairs}` : "",
      result.runs ? `Runs ${result.runs}` : "",
      result.flush ? `Flush ${result.flush}` : "",
      result.nobs ? "Nobs 1" : "",
    ].filter(Boolean).join(" · ");
    award(state, player, result.points, `${player === state.dealer ? "Dealer" : "Non-dealer"} hand${details ? ` · ${details}` : ""}`);
    if (state.winner !== null) return state;
  }
  const cribScore = scoreHand(state.crib, state.starter, true);
  const cribDetails = [
    cribScore.fifteens ? `Fifteens ${cribScore.fifteens}` : "",
    cribScore.pairs ? `Pairs ${cribScore.pairs}` : "",
    cribScore.runs ? `Runs ${cribScore.runs}` : "",
    cribScore.flush ? `Flush ${cribScore.flush}` : "",
    cribScore.nobs ? "Nobs 1" : "",
  ].filter(Boolean).join(" · ");
  award(state, state.dealer, cribScore.points, `Dealer crib${cribDetails ? ` · ${cribDetails}` : ""}`);
  if (state.winner !== null) return state;
  state.dealer = 1 - state.dealer;
  state.round++;
  const deck = nextDeck ?? shuffleDeck();
  state.deck = [...deck]; state.hands = [[], []]; state.showHands = [[], []];
  for (let i = 0; i < 6; i++) { state.hands[0].push(state.deck.shift()!); state.hands[1].push(state.deck.shift()!); }
  state.crib = []; state.starter = null; state.discarded = [false, false];
  state.count = 0; state.sequence = []; state.lastPlayer = null; state.passed = [false, false]; state.turn = 0;
  state.phase = "discard";
  return state;
}

export function legalCards(state: GameState, player = state.turn): Card[] {
  if (state.phase !== "pegging" || player !== state.turn || state.passed[player]) return [];
  return state.hands[player].filter(card => state.count + pip(card) <= 31);
}

export function canSayGo(state: GameState, player = state.turn): boolean {
  return state.phase === "pegging" && player === state.turn && legalCards(state, player).length === 0 && !state.passed[player];
}

export function applyComputer(state: GameState, selectPegging: (hand: Card[], legal: Card[], sequence: Card[], count: number) => string): GameState {
  while (state.phase === "pegging" && state.turn === 1 && state.winner === null) {
    const options = legalCards(state, 1);
    if (!options.length) sayGo(state, 1);
    else playCard(state, 1, selectPegging(state.hands[1], options, state.sequence, state.count));
  }
  return state;
}
