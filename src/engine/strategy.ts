import type { Card, Difficulty, GameState } from "./types";
import { createDeck, legalCards, playCard, sayGo } from "./game";
import { pip, scoreHand, scorePegging } from "./scoring";

function combinations<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, current: T[]) => {
    if (current.length === size) { result.push([...current]); return; }
    for (let i = start; i <= values.length - (size - current.length); i++) visit(i + 1, [...current, values[i]]);
  };
  visit(0, []);
  return result;
}

function knownStarterAverage(hand: Card[], unseen: Card[]) {
  let total = 0;
  for (const starter of unseen) total += scoreHand(hand, starter).points;
  return total / Math.max(1, unseen.length);
}

export function chooseDiscards(state: GameState, difficulty: Difficulty, random: () => number = Math.random): string[] {
  const hand = state.hands[1];
  let best: { ids: string[]; value: number } = { ids: [], value: -Infinity };
  // Only the computer's six visible cards are excluded; human cards and crib discards stay unknown.
  const unseen = createDeck().filter(card => !hand.some(held => held.id === card.id));
  for (const pair of combinations(hand, 2)) {
    const kept = hand.filter(card => !pair.some(discard => discard.id === card.id));
    if (difficulty === "easy") {
      const rankPotential = kept.reduce((sum, card) => sum + (card.rank === 5 ? 1.9 : card.rank >= 10 ? 1.2 : card.rank <= 4 ? 0.7 : 0.25), 0);
      const pairPotential = kept.reduce((sum, card, index) => sum + kept.slice(index + 1).filter(other => other.rank === card.rank).length * 3.2, 0);
      const cribRisk = pair.reduce((sum, card) => sum + (card.rank === 5 ? 1.4 : pip(card) >= 10 ? 0.4 : 0), 0);
      const noise = (random() - 0.5) * 2.8;
      const value = rankPotential + pairPotential - (state.dealer === 0 ? cribRisk : -cribRisk * 0.55) + noise;
      if (value > best.value) best = { ids: pair.map(card => card.id), value };
      continue;
    }
    const handValue = knownStarterAverage(kept, unseen);
    let cribValue = 0;
    const sampleCount = difficulty === "hard" ? 18 : 7;
    for (let sample = 0; sample < sampleCount; sample++) {
      const shuffled = [...unseen];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const cribExtras = shuffled.slice(0, 2);
      const starter = shuffled[2];
      cribValue += scoreHand([...pair, ...cribExtras], starter, true).points;
    }
    cribValue /= sampleCount;
    const dealerFactor = state.dealer === 1 ? (difficulty === "hard" ? 0.9 : 0.7) : (difficulty === "hard" ? -0.8 : -0.45);
    const value = handValue + cribValue * dealerFactor;
    if (value > best.value) best = { ids: pair.map(card => card.id), value };
  }
  return best.ids;
}

export function choosePeggingCard(hand: Card[], legal: Card[], sequence: Card[], count: number, difficulty: Difficulty): string {
  let best = legal[0];
  let bestValue = -Infinity;
  for (const card of legal) {
    const score = scorePegging(sequence, card);
    const nextCount = count + pip(card);
    const remaining = hand.filter(item => item.id !== card.id);
    let value = score.points * (difficulty === "easy" ? 2.4 : difficulty === "hard" ? 5 : 3.6);
    if (nextCount === 5) value -= difficulty === "hard" ? 5.5 : 3.1;
    if (nextCount === 21) value -= difficulty === "hard" ? 4 : 2;
    if (remaining.some(item => item.rank === card.rank)) value += 1.2;
    if (sequence.length === 0) value += card.rank <= 4 ? 1.3 : card.rank === 5 ? -2.4 : card.rank >= 10 ? 0.7 : 0;
    if (sequence.length && sequence.at(-1)!.rank === card.rank) value -= 2.5;
    if (sequence.length >= 1 && Math.abs(sequence.at(-1)!.rank - card.rank) <= 2) value -= 0.8;
    if (difficulty === "easy") value += (Math.random() - 0.5) * 3.2;
    if (value > bestValue) { bestValue = value; best = card; }
  }
  return best.id;
}

export function runComputerTurn(state: GameState): GameState {
  let previous = `${state.phase}:${state.turn}:${state.sequence.length}:${state.count}`;
  while (state.phase === "pegging" && state.turn === 1 && state.winner === null) {
    const legal = legalCards(state, 1);
    if (!legal.length) sayGo(state, 1);
    else playCard(state, 1, choosePeggingCard(state.hands[1], legal, state.sequence, state.count, state.difficulty));
    const next = `${state.phase}:${state.turn}:${state.sequence.length}:${state.count}`;
    if (next === previous) break;
    previous = next;
  }
  return state;
}
