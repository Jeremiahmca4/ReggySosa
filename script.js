/*
 * Core functions for Reggy Sosa's tournament platform.
 * This file implements user authentication, tournament management and
 * bracket generation entirely in the browser using localStorage.
 *
 * NOTE: This implementation is for demo purposes only and does not
 * persist data across different browsers or users. For a production
 * environment you should use a proper back‑end and database.
 */

// === Local storage helpers ===

// Define the single admin email. Only this email is treated as admin.
const ADMIN_EMAIL = '93pacc93@gmail.com';
function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem('users')) || [];
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem('users', JSON.stringify(users));
}

function loadTournaments() {
  try {
    return JSON.parse(localStorage.getItem('tournaments')) || [];
  } catch (e) {
    return [];
  }
}

function saveTournaments(tournaments) {
  localStorage.setItem('tournaments', JSON.stringify(tournaments));
}

function getCurrentUser() {
  return localStorage.getItem('currentUser') || null;
}

function setCurrentUser(email) {
  if (email) {
    localStorage.setItem('currentUser', email);
  } else {
    localStorage.removeItem('currentUser');
  }
}

// Ensure there is at least one admin user (for demo)
function ensureDefaultAdmin() {
  const users = loadUsers();
  // If the designated admin user does not exist, create it with a default password.
  // We do not treat any other stored user as admin.
  const existingAdminIndex = users.findIndex((u) => u.email === ADMIN_EMAIL);
  if (existingAdminIndex === -1) {
    // Add the admin user. Using a default password; should be updated by actual admin.
    users.push({ email: ADMIN_EMAIL.toLowerCase(), password: 'admin123', role: 'admin' });
    saveUsers(users);
  } else {
    // Ensure the role for the admin email is always 'admin'.
    if (users[existingAdminIndex].role !== 'admin') {
      users[existingAdminIndex].role = 'admin';
      saveUsers(users);
    }
  }
}

// === Authentication ===
function handleRegister() {
  ensureDefaultAdmin();
  const email = document.getElementById('register-email').value.trim().toLowerCase();
  const password = document.getElementById('register-password').value;
  const users = loadUsers();
  if (users.some((u) => u.email === email)) {
    alert('An account with this email already exists.');
    return;
  }
  // Assign role based on whether the email matches the single admin email.
  const role = email === ADMIN_EMAIL ? 'admin' : 'user';
  users.push({ email, password, role });
  saveUsers(users);
  setCurrentUser(email);
  alert('Registration successful! You are now logged in.');
  window.location.href = 'tournaments.html';
}

function handleLogin() {
  ensureDefaultAdmin();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const users = loadUsers();
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) {
    alert('Invalid email or password.');
    return;
  }
  setCurrentUser(email);
  alert('Login successful!');
  // redirect to previous page or tournaments
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  window.location.href = redirect || 'tournaments.html';
}

function logout() {
  setCurrentUser(null);
  // reload current page to update UI
  window.location.reload();
}

function getCurrentUserRole() {
  const email = getCurrentUser();
  if (!email) return null;
  // Only treat the designated admin email as admin.
  if (email === ADMIN_EMAIL) return 'admin';
  return 'user';
}

// Populate login/register or user/logout links in nav
function populateAuthLinks() {
  ensureDefaultAdmin();
  const authLinksEl = document.getElementById('auth-links');
  if (!authLinksEl) return;
  authLinksEl.innerHTML = '';
  const userEmail = getCurrentUser();
  if (userEmail) {
    const nameSpan = document.createElement('span');
    nameSpan.textContent = userEmail;
    nameSpan.className = 'user-email';
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', logout);
    authLinksEl.appendChild(nameSpan);
    authLinksEl.appendChild(logoutBtn);
  } else {
    const loginLink = document.createElement('a');
    loginLink.href = 'login.html';
    loginLink.textContent = 'Login';
    const registerLink = document.createElement('a');
    registerLink.href = 'register.html';
    registerLink.textContent = 'Register';
    authLinksEl.appendChild(loginLink);
    authLinksEl.appendChild(registerLink);
  }
  // Hide admin nav item for non-admins
  const adminNav = document.getElementById('admin-nav');
  if (adminNav) {
    const role = getCurrentUserRole();
    adminNav.style.display = role === 'admin' ? 'inline' : 'none';
  }
}

// Ensure the current user is an admin; if not, redirect to login
function ensureAdminAccess() {
  const role = getCurrentUserRole();
  if (role !== 'admin') {
    alert('You must be an admin to access this page.');
    // redirect to login with redirect param
    window.location.href = 'login.html?redirect=admin.html';
  }
}

// === Tournament management ===
function renderTournaments() {
  const listEl = document.getElementById('tournaments-list');
  if (!listEl) return;
  const tournaments = loadTournaments();
  // Sort by creation date descending
  tournaments.sort((a, b) => new Date(b.created) - new Date(a.created));
  listEl.innerHTML = '';
  if (tournaments.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.textContent = 'No tournaments found.';
    listEl.appendChild(emptyMsg);
    return;
  }
  tournaments.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tournament-card';
    const title = document.createElement('h3');
    title.textContent = t.name;
    const status = document.createElement('p');
    status.textContent = 'Status: ' + (t.status || 'open');
    const teamsCount = document.createElement('p');
    teamsCount.textContent = 'Teams: ' + (t.teams ? t.teams.length : 0);
    const link = document.createElement('a');
    link.href = 'tournament.html?id=' + encodeURIComponent(t.id);
    link.className = 'button';
    link.textContent = 'View';
    card.appendChild(title);
    card.appendChild(status);
    card.appendChild(teamsCount);
    card.appendChild(link);
    listEl.appendChild(card);
  });
}

function renderAdminTournaments() {
  const listEl = document.getElementById('admin-tournament-list');
  if (!listEl) return;
  const tournaments = loadTournaments();
  tournaments.sort((a, b) => new Date(b.created) - new Date(a.created));
  listEl.innerHTML = '';
  if (tournaments.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.textContent = 'No tournaments yet. Create one above.';
    listEl.appendChild(emptyMsg);
    return;
  }
  tournaments.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tournament-card';
    const title = document.createElement('h3');
    title.textContent = t.name;
    const status = document.createElement('p');
    status.textContent = 'Status: ' + (t.status || 'open');
    const teamsCount = document.createElement('p');
    teamsCount.textContent = 'Teams: ' + (t.teams ? t.teams.length : 0);
    // Actions
    const actions = document.createElement('div');
    actions.className = 'admin-actions';
    // Start button
    const startBtn = document.createElement('button');
    startBtn.className = 'start';
    startBtn.textContent = t.status === 'started' ? 'Started' : 'Start';
    startBtn.disabled = t.status === 'started';
    startBtn.addEventListener('click', () => {
      startTournament(t.id);
    });
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      deleteTournament(t.id);
    });
    actions.appendChild(startBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(title);
    card.appendChild(status);
    card.appendChild(teamsCount);
    card.appendChild(actions);
    listEl.appendChild(card);
  });
}

function createTournamentFromForm() {
  const nameInput = document.getElementById('tournament-name');
  const teamsInput = document.getElementById('tournament-teams');
  const name = nameInput.value.trim();
  if (!name) {
    alert('Please enter a tournament name.');
    return;
  }
  const teamsText = teamsInput.value.trim();
  const teams = teamsText
    ? teamsText
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];
  const tournaments = loadTournaments();
  const id = Date.now().toString();
  const newTournament = {
    id,
    name,
    teams,
    created: new Date().toISOString(),
    status: 'open',
    bracket: [],
  };
  tournaments.push(newTournament);
  saveTournaments(tournaments);
  nameInput.value = '';
  teamsInput.value = '';
  renderAdminTournaments();
  alert('Tournament created successfully.');
}

function deleteTournament(id) {
  if (!confirm('Are you sure you want to delete this tournament?')) return;
  let tournaments = loadTournaments();
  tournaments = tournaments.filter((t) => t.id !== id);
  saveTournaments(tournaments);
  renderAdminTournaments();
}

function startTournament(id) {
  let tournaments = loadTournaments();
  const index = tournaments.findIndex((t) => t.id === id);
  if (index === -1) return;
  const t = tournaments[index];
  if (t.status === 'started') return;
  if (!t.teams || t.teams.length < 2) {
    alert('At least two teams are required to start a tournament.');
    return;
  }
  t.status = 'started';
  t.bracket = generateBracket(t.teams);
  tournaments[index] = t;
  saveTournaments(tournaments);
  renderAdminTournaments();
  alert('Tournament started! The bracket has been generated.');
}

function renderTournamentDetails(id) {
  const container = document.getElementById('tournament-container');
  if (!container) return;
  const tournaments = loadTournaments();
  const tournament = tournaments.find((t) => t.id === id);
  if (!tournament) {
    container.innerHTML = '<p>Tournament not found.</p>';
    return;
  }
  const role = getCurrentUserRole();
  container.innerHTML = '';
  const detail = document.createElement('div');
  detail.className = 'tournament-detail';
  const title = document.createElement('h2');
  title.textContent = tournament.name;
  const status = document.createElement('p');
  status.textContent = 'Status: ' + tournament.status;
  const created = document.createElement('p');
  const date = new Date(tournament.created);
  created.textContent = 'Created: ' + date.toLocaleString();
  detail.appendChild(title);
  detail.appendChild(status);
  detail.appendChild(created);
  // Teams list
  if (tournament.teams && tournament.teams.length > 0) {
    const teamsHeading = document.createElement('h3');
    teamsHeading.textContent = 'Teams';
    const teamsList = document.createElement('ul');
    teamsList.className = 'teams-list';
    tournament.teams.forEach((team) => {
      const li = document.createElement('li');
      li.textContent = team;
      teamsList.appendChild(li);
    });
    detail.appendChild(teamsHeading);
    detail.appendChild(teamsList);
  }
  // Bracket
  if (tournament.status === 'started' && tournament.bracket) {
    const bracketHeading = document.createElement('h3');
    bracketHeading.textContent = 'Bracket';
    const bracketDiv = document.createElement('div');
    bracketDiv.className = 'bracket';
    tournament.bracket.forEach((round, rIndex) => {
      const roundDiv = document.createElement('div');
      roundDiv.className = 'round';
      const roundTitle = document.createElement('h4');
      roundTitle.textContent = 'Round ' + (rIndex + 1);
      roundDiv.appendChild(roundTitle);
      round.forEach((match, mIndex) => {
        const matchDiv = document.createElement('div');
        matchDiv.className = 'match';
        const matchTitle = document.createElement('p');
        matchTitle.textContent = match.team1 + ' vs. ' + (match.team2 || 'BYE');
        const code = document.createElement('p');
        code.textContent = 'Match code: ' + match.code;
        matchDiv.appendChild(matchTitle);
        matchDiv.appendChild(code);
        roundDiv.appendChild(matchDiv);
      });
      bracketDiv.appendChild(roundDiv);
    });
    detail.appendChild(bracketHeading);
    detail.appendChild(bracketDiv);
  }
  // Admin controls for this tournament
  if (role === 'admin') {
    const adminActions = document.createElement('div');
    adminActions.className = 'admin-actions';
    // Start button (if not started)
    if (tournament.status !== 'started') {
      const startBtn = document.createElement('button');
      startBtn.className = 'start';
      startBtn.textContent = 'Start';
      startBtn.addEventListener('click', () => {
        startTournament(tournament.id);
        // re-render details after starting
        renderTournamentDetails(tournament.id);
      });
      adminActions.appendChild(startBtn);
    }
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      deleteTournament(tournament.id);
      window.location.href = 'tournaments.html';
    });
    adminActions.appendChild(deleteBtn);
    detail.appendChild(adminActions);
  }
  container.appendChild(detail);
}

// === Bracket generation ===
function generateCode() {
  // Generate a random 5‑digit code (digits only)
  return Math.floor(10000 + Math.random() * 90000).toString();
}

function generateBracket(teams) {
  /*
   * Generate a knockout bracket for the provided teams. If the number of
   * teams is not a power of two we pad the first round with BYE slots
   * and propagate TBD placeholders into subsequent rounds. Each match
   * receives a 5‑digit code.
   */
  // Clone and shuffle the team list
  const shuffled = teams.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Determine bracket size (next power of two)
  let size = 1;
  while (size < shuffled.length) size *= 2;
  const totalRounds = Math.log2(size);
  // Pad with BYE until we reach the bracket size
  const firstRoundTeams = shuffled.slice();
  while (firstRoundTeams.length < size) {
    firstRoundTeams.push('BYE');
  }
  const rounds = [];
  let currentTeams = firstRoundTeams;
  for (let r = 0; r < totalRounds; r++) {
    const round = [];
    for (let i = 0; i < currentTeams.length; i += 2) {
      let team1 = currentTeams[i];
      let team2 = currentTeams[i + 1];
      // normalise undefined/null placeholders
      if (!team1) team1 = 'TBD';
      if (!team2) {
        team2 = team1 === 'BYE' ? 'TBD' : 'BYE';
      }
      round.push({ team1, team2, code: generateCode(), winner: null });
    }
    rounds.push(round);
    // Prepare array for next round winners (unknown winners become null)
    currentTeams = new Array(round.length).fill(null);
  }
  return rounds;
}