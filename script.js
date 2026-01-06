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
  // Pre-seeding an admin user is no longer necessary.
  // Admin will be treated specially only after registration.
  return;
}

// === Authentication ===
function handleRegister() {
  ensureDefaultAdmin();
  const email = document.getElementById('register-email').value.trim().toLowerCase();
  const password = document.getElementById('register-password').value;
  const users = loadUsers();
  if (users.some((u) => u.email === email)) {
    // If the email already exists, inform user and redirect to login page
    alert('Account already exists — please log in.');
    // Redirect to login page so the user can sign in
    window.location.href = 'login.html';
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
    // Display current number of teams and maximum slots if defined
    const currentCount = t.teams ? t.teams.length : 0;
    const maxCount = t.maxTeams ? t.maxTeams : null;
    teamsCount.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
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
    // Display current team count and maximum
    const teamsCount = document.createElement('p');
    const currentCount = t.teams ? t.teams.length : 0;
    const maxCount = t.maxTeams ? t.maxTeams : null;
    teamsCount.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
    // Display max teams explicitly (optional)
    // const maxTeamsEl = document.createElement('p');
    // maxTeamsEl.textContent = 'Max teams: ' + (t.maxTeams || '—');
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
    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      editTournament(t.id);
    });
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      deleteTournament(t.id);
    });
    actions.appendChild(startBtn);
    actions.appendChild(editBtn);
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
  const maxTeamsInput = document.getElementById('tournament-max-teams');
  const name = nameInput.value.trim();
  if (!name) {
    alert('Please enter a tournament name.');
    return;
  }
  // Read the maximum number of teams from the admin input
  const maxVal = parseInt(maxTeamsInput.value, 10);
  if (!maxVal || maxVal < 2) {
    alert('Please enter a valid maximum number of teams (at least 2).');
    return;
  }
  const tournaments = loadTournaments();
  const id = Date.now().toString();
  // Create a new tournament object with an empty teams array and maxTeams limit
  const newTournament = {
    id,
    name,
    teams: [],
    maxTeams: maxVal,
    created: new Date().toISOString(),
    status: 'open',
    bracket: [],
  };
  tournaments.push(newTournament);
  saveTournaments(tournaments);
  // Reset form fields
  nameInput.value = '';
  maxTeamsInput.value = '';
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

// Allow the admin to edit tournament details (name and maximum number of teams)
function editTournament(id) {
  let tournaments = loadTournaments();
  const index = tournaments.findIndex((t) => t.id === id);
  if (index === -1) return;
  const t = tournaments[index];
  // Prompt the admin for a new name
  const newName = prompt('Edit tournament name:', t.name);
  if (newName !== null) {
    const trimmed = newName.trim();
    if (trimmed.length > 0) {
      t.name = trimmed;
    }
  }
  // If the tournament has not started yet, allow editing maxTeams
  if (t.status !== 'started') {
    const currentTeams = t.teams ? t.teams.length : 0;
    const maxPrompt = prompt('Edit maximum number of teams:', t.maxTeams || currentTeams || 2);
    if (maxPrompt !== null && maxPrompt !== '') {
      const maxVal = parseInt(maxPrompt, 10);
      if (isNaN(maxVal) || maxVal < 2 || maxVal < currentTeams) {
        alert(
          'Invalid maximum. It must be a number at least equal to the number of registered teams (' +
            currentTeams +
            ') and at least 2.'
        );
      } else {
        t.maxTeams = maxVal;
      }
    }
  } else {
    alert('Cannot edit maximum teams after the tournament has started.');
  }
  tournaments[index] = t;
  saveTournaments(tournaments);
  renderAdminTournaments();
  alert('Tournament updated.');
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
  // Show current and maximum team slots if available
  if (tournament.maxTeams) {
    const maxInfo = document.createElement('p');
    const currentCount = tournament.teams ? tournament.teams.length : 0;
    maxInfo.textContent = 'Teams: ' + currentCount + ' / ' + tournament.maxTeams;
    detail.appendChild(maxInfo);
  }
  // Teams list
  if (tournament.teams && tournament.teams.length > 0) {
    const teamsHeading = document.createElement('h3');
    teamsHeading.textContent = 'Registered Teams';
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

  // Allow non-admin users to register their own team while the tournament is open
  if (role !== 'admin' && tournament.status !== 'started') {
    const currentCount = tournament.teams ? tournament.teams.length : 0;
    const maxCount = tournament.maxTeams || null;
    // Show registration form only if there is no limit or if slots remain
    if (!maxCount || currentCount < maxCount) {
      const joinHeading = document.createElement('h3');
      joinHeading.textContent = 'Register Your Team';
      const joinForm = document.createElement('form');
      joinForm.id = 'join-team-form';
      joinForm.style.marginTop = '1rem';
      // Team name input
      const teamInput = document.createElement('input');
      teamInput.type = 'text';
      teamInput.placeholder = 'Team name';
      teamInput.required = true;
      teamInput.style.display = 'block';
      teamInput.style.width = '100%';
      teamInput.style.padding = '0.5rem';
      teamInput.style.marginBottom = '0.5rem';
      teamInput.style.border = 'none';
      teamInput.style.borderRadius = '4px';
      teamInput.style.backgroundColor = '#1e2153';
      teamInput.style.color = '#ffffff';
      // Register button
      const joinBtn = document.createElement('button');
      joinBtn.textContent = 'Register';
      joinBtn.className = 'button';
      joinForm.appendChild(teamInput);
      joinForm.appendChild(joinBtn);
      joinForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const name = teamInput.value.trim();
        if (!name) {
          alert('Please enter a team name.');
          return;
        }
        // Prevent duplicate team names
        if (tournament.teams && tournament.teams.includes(name)) {
          alert('A team with this name is already registered.');
          return;
        }
        // Ensure there is room to add
        const current = tournament.teams ? tournament.teams.length : 0;
        if (tournament.maxTeams && current >= tournament.maxTeams) {
          alert('Registration is full for this tournament.');
          return;
        }
        // Append the new team
        if (!tournament.teams) tournament.teams = [];
        tournament.teams.push(name);
        // Persist changes to storage
        const allTournaments = loadTournaments();
        const idx = allTournaments.findIndex((tt) => tt.id === tournament.id);
        if (idx !== -1) {
          allTournaments[idx] = tournament;
          saveTournaments(allTournaments);
        }
        // Re-render details to reflect new team
        renderTournamentDetails(tournament.id);
        alert('Team registered successfully!');
      });
      detail.appendChild(joinHeading);
      detail.appendChild(joinForm);
    } else {
      // Tournament is full
      const fullMsg = document.createElement('p');
      fullMsg.textContent = 'Registration is full for this tournament.';
      detail.appendChild(fullMsg);
    }
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