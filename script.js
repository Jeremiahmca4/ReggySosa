// This script provides fixes for tournament persistence and match code visibility
// by sending bracket and winner to backend and regenerating bracket for participants.
// Insert this code into your existing script.js file where appropriate.

// Function to generate a seeded random number generator (immutable) for deterministic bracket
function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return function() {
    x = Math.sin(x) * 10000;
    return x - Math.floor(x);
  };
}

// Generate bracket deterministically based on tournament id and teams
function generateBracket(tournament) {
  const teams = [...tournament.teams];
  const rnd = seededRandom(tournament.id.hashCode());
  // simple shuffle
  for (let i = teams.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  // Build matches round 1
  const matches = [];
  for (let i = 0; i < teams.length; i += 2) {
    matches.push({ team1: teams[i], team2: teams[i+1] || null, winner: null, code: Math.floor(10000 + rnd() * 90000).toString() });
  }
  tournament.bracket = [matches];
}

// Reporting match result and persist bracket & status
async function reportMatch(tournamentId, roundIndex, matchIndex, winnerTeamId) {
  const tournament = getTournamentById(tournamentId);
  const match = tournament.bracket[roundIndex][matchIndex];
  match.winner = winnerTeamId;
  // propagate winners to next round
  let nextRound = tournament.bracket[roundIndex + 1];
  if (!nextRound) {
    tournament.bracket.push([]);
    nextRound = tournament.bracket[roundIndex + 1];
  }
  const nextMatchIndex = Math.floor(matchIndex / 2);
  if (!nextRound[nextMatchIndex]) nextRound[nextMatchIndex] = { team1: null, team2: null, winner: null, code: Math.floor(10000 + Math.random() * 90000).toString() };
  const nextMatch = nextRound[nextMatchIndex];
  if (matchIndex % 2 === 0) nextMatch.team1 = winnerTeamId; else nextMatch.team2 = winnerTeamId;
  // if final
  const finalRound = roundIndex === tournament.bracket.length - 2 && nextRound.length === 1;
  if (finalRound) {
    tournament.winner = winnerTeamId;
    tournament.status = 'completed';
  }
  // Persist to backend
  await fetch(`${API_BASE_URL}/api/tournaments/${tournamentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: tournament.status, bracket: tournament.bracket, winner: tournament.winner })
  });
  saveTournaments();
}

// When viewing tournament details, ensure bracket is present and generate if needed
function ensureBracket(tournament) {
  if (!tournament.bracket || tournament.bracket.length === 0) {
    generateBracket(tournament);
  }
}

// In renderTournamentDetails, call ensureBracket(tournament) before rendering matches
// and show codes to participants:
//   if (currentUserIsAdmin || currentUserTeamId === match.team1 || currentUserTeamId === match.team2) {
//       display match.code
//   } else {
//       display '(hidden)'
//   }

// Extend String prototype for seeded hashing
String.prototype.hashCode = function() {
  var hash = 0, i, chr;
  if (this.length === 0) return hash;
  for (i = 0; i < this.length; i++) {
    chr   = this.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
};
