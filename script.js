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

// === Supabase initialisation ===
// Attempt to read Supabase credentials from global variables injected at deploy time.
// These should be provided via NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
// Supabase configuration. Use values provided via runtime globals if available,
// otherwise fall back to the project's built‑in defaults.
// These defaults correspond to your Supabase project and anon key.
const SUPABASE_URL =
  (typeof window !== 'undefined' && window.NEXT_PUBLIC_SUPABASE_URL) ||
  'https://jutrghyaucdupgiwixtv.supabase.co';
const SUPABASE_ANON_KEY =
  (typeof window !== 'undefined' && window.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1dHJnaHlhdWNkdXBnaXdpeHR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MDIxODcsImV4cCI6MjA4MzM3ODE4N30.XiJK6YQzVkofTK8ZyYYK6ZEzTfW3rX-LbuEGaT93aYc';
// The UMD build of supabase attaches a global `supabase` object. Create a client if credentials are present.
let supabaseClient = null;
if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// === Static champions ===
// A list of past tournaments and their champions prior to this website's launch.
// These are displayed in the Past Champions section on the tournaments page.
const STATIC_CHAMPIONS = [
  {
    tournament: 'The Inaugural Sosa Cup',
    champion: 'P L A Y E R S',
  },
  {
    tournament: 'October Sosa Cup',
    champion: 'les canadiens francais',
  },
  {
    tournament: "Reggy Sosa's Holiday Classic Cup",
    champion: 'les canadiens français',
  },
];

// === Backend API base URL ===
// Define the base URL for the server‑side API. This allows the frontend to
// communicate with the Next.js back‑end that persists data to Supabase.
// It will prefer a runtime value exposed on the global object (via env.js)
// but fall back to the production backend hosted on Vercel.
const API_BASE_URL =
  (typeof window !== 'undefined' && window.NEXT_PUBLIC_API_BASE_URL) ||
  'https://reggysosa-backend.vercel.app';

/**
 * Synchronise tournaments from the back‑end into localStorage.
 *
 * This fetches all tournaments from the API, maps the fields into the local
 * storage format and saves them. If the request fails for any reason, the
 * existing local data remains untouched.
 */
async function syncTournamentsFromBackend() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/tournaments`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      const transformed = data.map((row) => ({
        id: (row.id ?? '').toString(),
        name: row.name,
        teams: [],
        maxTeams: row.max_teams ?? row.maxTeams ?? null,
        startDate: row.start_date ?? row.startDate ?? null,
        status: row.status || 'open',
        created: row.created_at ?? row.created ?? new Date().toISOString(),
        bracket: [],
        winner: row.winner || null,
      }));
      saveTournaments(transformed);
    }
  } catch (err) {
    console.error('Failed to sync tournaments from backend:', err);
  }
}

/**
 * Synchronise teams from the back‑end into localStorage.
 *
 * This fetches all teams from the API and converts them into the local
 * format. Invites are persisted server‑side, so they are included in
 * the returned data. If the request fails, local data remains unchanged.
 */
async function syncTeamsFromBackend() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/teams`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      const transformed = data.map((row) => ({
        id: (row.id ?? '').toString(),
        name: row.name,
        captain: row.captain,
        members: Array.isArray(row.members) ? row.members : [],
        invites: Array.isArray(row.invites) ? row.invites : [],
      }));
      saveTeams(transformed);
    }
  } catch (err) {
    console.error('Failed to sync teams from backend:', err);
  }
}

/**
 * Synchronise the Supabase auth session into localStorage.
 * If a session exists, set currentUser to the authenticated email.
 * Otherwise, clear currentUser.
 */
async function syncSession() {
  if (!supabaseClient) {
    return;
  }
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user && session.user.email) {
      // Persist the authenticated email in lower case
      setCurrentUser(session.user.email.toLowerCase());
    } else {
      setCurrentUser(null);
    }
  } catch (err) {
    console.error('Failed to sync Supabase session:', err);
  }
}
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

// === Team management helpers ===
function loadTeams() {
  try {
    return JSON.parse(localStorage.getItem('teams')) || [];
  } catch (e) {
    return [];
  }
}

function saveTeams(teams) {
  localStorage.setItem('teams', JSON.stringify(teams));
}

// Retrieve the team object for the current user, if any
function getUserTeam() {
  const currentEmail = getCurrentUser();
  if (!currentEmail) return null;
  const users = loadUsers();
  const user = users.find((u) => u.email === currentEmail);
  if (!user || !user.teamId) return null;
  const teams = loadTeams();
  return teams.find((t) => t.id === user.teamId) || null;
}

// Set the teamId for a given user in the users array
function setUserTeam(email, teamId) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.email === email);
  if (idx !== -1) {
    users[idx].teamId = teamId;
    saveUsers(users);
  }
}

// Accept any pending team invites for the given email upon registration/login
function acceptInvitesForUser(email) {
  const teams = loadTeams();
  let updated = false;
  teams.forEach((team) => {
    if (team.invites && team.invites.includes(email)) {
      // Remove from invites
      team.invites = team.invites.filter((inv) => inv !== email);
      // Add to members if not already
      if (!team.members.includes(email)) {
        team.members.push(email);
        // Assign teamId to user if they do not have one
        const users = loadUsers();
        const uIdx = users.findIndex((u) => u.email === email);
        if (uIdx !== -1) {
          if (!users[uIdx].teamId) {
            users[uIdx].teamId = team.id;
          }
          saveUsers(users);
        }
      }
      updated = true;
    }
  });
  if (updated) {
    saveTeams(teams);
  }
}

// Create a new team with the given name for the current user as captain
function createTeam(name) {
  const currentEmail = getCurrentUser();
  if (!currentEmail) {
    alert('You must be logged in to create a team.');
    return null;
  }
  const trimmed = (name || '').trim();
  if (!trimmed) {
    alert('Please enter a team name.');
    return null;
  }
  // Check that the user is not already in a team
  if (getUserTeam()) {
    alert('You are already a member of a team.');
    return null;
  }
  const teams = loadTeams();
  // Ensure unique name
  if (teams.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
    alert('A team with this name already exists.');
    return null;
  }
  // Generate a unique identifier for the team. Use crypto.randomUUID() when
  // available (supported in modern browsers) and fall back to a timestamp
  // string in older environments.
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now().toString();
  const newTeam = {
    id: id,
    name: trimmed,
    captain: currentEmail,
    members: [currentEmail],
    invites: [],
  };
  teams.push(newTeam);
  saveTeams(teams);
  setUserTeam(currentEmail, id);
  // Persist the new team to the back‑end. This call is fire‑and‑forget; any
  // network errors will be silently ignored so the UI remains responsive.
  try {
    fetch(`${API_BASE_URL}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newTeam.id,
        name: newTeam.name,
        captain: newTeam.captain,
        members: newTeam.members,
        invites: newTeam.invites,
      }),
    }).catch(() => {
      /* ignore errors */
    });
  } catch (err) {
    console.error('Failed to create team on backend:', err);
  }
  // Optionally refresh teams from the backend to keep IDs in sync. This
  // call is non‑blocking; any errors are ignored.
  if (typeof syncTeamsFromBackend === 'function') {
    try {
      syncTeamsFromBackend().catch(() => {
        /* ignore errors */
      });
    } catch (_) {
      /* ignore */
    }
  }
  alert('Team created successfully.');
  return newTeam;
}

// Invite a user (by email) to join the specified team
function inviteToTeam(teamId, inviteEmail) {
  const teams = loadTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team) return;
  const email = (inviteEmail || '').trim().toLowerCase();
  if (!email) {
    alert('Please enter an email to invite.');
    return;
  }
  if (team.members.includes(email)) {
    alert('This user is already a member of the team.');
    return;
  }
  if (team.invites && team.invites.includes(email)) {
    alert('This user has already been invited.');
    return;
  }
  team.invites.push(email);
  saveTeams(teams);
  // Persist the invite to the back‑end. This call updates the invites
  // array for the team on the server. It is non‑blocking; any network
  // errors will be ignored to avoid disrupting the UI.
  try {
    fetch(`${API_BASE_URL}/api/teams/${encodeURIComponent(teamId)}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {
      /* ignore errors */
    });
  } catch (err) {
    console.error('Failed to invite user on backend:', err);
  }
  alert('Invitation added. Note: no actual email is sent in this demo.');
}

// Render the current user's team or a creation form in tournaments.html
function renderUserTeam() {
  const section = document.getElementById('user-team-section');
  if (!section) return;
  section.innerHTML = '';
  const currentEmail = getCurrentUser();
  if (!currentEmail) {
    const msg = document.createElement('p');
    msg.textContent = 'Please log in to manage your team.';
    section.appendChild(msg);
    return;
  }
  const team = getUserTeam();
  if (!team) {
    const heading = document.createElement('h2');
    heading.textContent = 'Create a Team';
    section.appendChild(heading);
    const form = document.createElement('form');
    form.id = 'create-team-form';
    const label = document.createElement('label');
    label.textContent = 'Team Name:';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'team-name';
    input.required = true;
    input.style.marginLeft = '0.5rem';
    label.appendChild(input);
    const button = document.createElement('button');
    button.textContent = 'Create Team';
    button.className = 'button';
    form.appendChild(label);
    form.appendChild(button);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      createTeam(input.value);
      renderUserTeam();
    });
    section.appendChild(form);
  } else {
    // Show team details
    const heading = document.createElement('h2');
    heading.textContent = 'Your Team: ' + team.name;
    section.appendChild(heading);
    // Members
    const membersHeading = document.createElement('h3');
    membersHeading.textContent = 'Members';
    section.appendChild(membersHeading);
    const membersList = document.createElement('ul');
    team.members.forEach((member) => {
      const li = document.createElement('li');
      li.textContent = member + (member === team.captain ? ' (Captain)' : '');
      membersList.appendChild(li);
    });
    section.appendChild(membersList);
    // Pending invites
    if (team.invites && team.invites.length > 0) {
      const invitesHeading = document.createElement('h3');
      invitesHeading.textContent = 'Pending Invites';
      section.appendChild(invitesHeading);
      const invitesList = document.createElement('ul');
      team.invites.forEach((inv) => {
        const li = document.createElement('li');
        li.textContent = inv;
        invitesList.appendChild(li);
      });
      section.appendChild(invitesList);
    }
    // If current user is captain, allow inviting
    if (team.captain === currentEmail) {
      const inviteForm = document.createElement('form');
      inviteForm.id = 'invite-form';
      inviteForm.style.marginTop = '1rem';
      const label = document.createElement('label');
      label.textContent = 'Invite by email:';
      const emailInput = document.createElement('input');
      emailInput.type = 'email';
      emailInput.required = true;
      emailInput.style.marginLeft = '0.5rem';
      label.appendChild(emailInput);
      const sendBtn = document.createElement('button');
      sendBtn.textContent = 'Invite';
      sendBtn.className = 'button';
      inviteForm.appendChild(label);
      inviteForm.appendChild(sendBtn);
      inviteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        inviteToTeam(team.id, emailInput.value);
        emailInput.value = '';
        // Re-render to show updated invites list
        renderUserTeam();
      });
      section.appendChild(inviteForm);
    }
  }
}

// Ensure there is at least one admin user (for demo)
function ensureDefaultAdmin() {
  // Pre-seeding an admin user is no longer necessary.
  // Admin will be treated specially only after registration.
  return;
}

// === Authentication ===
async function handleRegister() {
  ensureDefaultAdmin();
  const email = document.getElementById('register-email').value.trim().toLowerCase();
  const password = document.getElementById('register-password').value;
  // Capture the optional Discord handle
  const discordInput = document.getElementById('register-discord');
  const discord = discordInput ? discordInput.value.trim() : '';
  // If a Supabase client is configured, register the user via Supabase Auth.
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) {
        alert(error.message || 'Registration failed.');
        return;
      }
    } catch (err) {
      alert('Registration failed.');
      console.error(err);
      return;
    }
  } else {
    // Fallback: ensure email is unique in local storage
    const users = loadUsers();
    if (users.some((u) => u.email === email)) {
      alert('Account already exists — please log in.');
      window.location.href = 'login.html';
      return;
    }
  }
  // Update or create the user record in local storage without storing the password.
  let usersList = loadUsers();
  const existing = usersList.find((u) => u.email === email);
  const role = email === ADMIN_EMAIL ? 'admin' : 'user';
  if (existing) {
    existing.role = role;
    existing.discord = discord;
    // Do not update password for security reasons
  } else {
    usersList.push({ email, password: '', role, discord, teamId: null });
  }
  saveUsers(usersList);
  setCurrentUser(email);
  acceptInvitesForUser(email);
  alert('Registration successful! You are now logged in.');
  window.location.href = 'tournaments.html';
}

async function handleLogin() {
  ensureDefaultAdmin();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        alert(error.message || 'Invalid email or password.');
        return;
      }
    } catch (err) {
      alert('Login failed.');
      console.error(err);
      return;
    }
  } else {
    // Fallback: verify credentials against local storage
    const users = loadUsers();
    const user = users.find((u) => u.email === email && u.password === password);
    if (!user) {
      alert('Invalid email or password.');
      return;
    }
  }
  // Ensure a user record exists in local storage to track roles and team membership.
  let usersList = loadUsers();
  let existing = usersList.find((u) => u.email === email);
  if (!existing) {
    const role = email === ADMIN_EMAIL ? 'admin' : 'user';
    usersList.push({ email, password: '', role, discord: '', teamId: null });
    saveUsers(usersList);
  }
  setCurrentUser(email);
  acceptInvitesForUser(email);
  alert('Login successful!');
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  window.location.href = redirect || 'tournaments.html';
}

async function logout() {
  // Sign out from Supabase session if configured
  if (supabaseClient) {
    try {
      await supabaseClient.auth.signOut();
    } catch (err) {
      console.error('Error signing out of Supabase:', err);
    }
  }
  setCurrentUser(null);
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
    // Prepare start date element if available; we'll append after teams count
    let startP = null;
    if (t.startDate) {
      const sd = new Date(t.startDate);
      startP = document.createElement('p');
      startP.textContent = 'Starts: ' + sd.toLocaleDateString();
    }
    const link = document.createElement('a');
    link.href = 'tournament.html?id=' + encodeURIComponent(t.id);
    link.className = 'button';
    link.textContent = 'View';
    card.appendChild(title);
    card.appendChild(status);
    card.appendChild(teamsCount);
    // Append start date after teams count, if present
    if (startP) {
      card.appendChild(startP);
    }
    card.appendChild(link);
    listEl.appendChild(card);
  });
}

/**
 * Render the list of past tournament winners.
 *
 * This looks for tournaments marked as completed with a winner defined and
 * displays them in the past-winners-list container. If there are no past
 * winners, the containing section is hidden.
 */
function renderPastWinners() {
  const section = document.getElementById('past-winners-section');
  const listEl = document.getElementById('past-winners-list');
  if (!section || !listEl) return;
  const tournaments = loadTournaments();
  // Filter tournaments that have been completed and have a winner
  const past = tournaments.filter(
    (t) => t.status === 'completed' && t.winner
  );
  listEl.innerHTML = '';
  if (past.length === 0) {
    // Hide the section if no past winners
    section.style.display = 'none';
    return;
  }
  // Ensure the section is visible
  section.style.display = '';
  // Sort past tournaments by creation date descending
  past.sort((a, b) => new Date(b.created) - new Date(a.created));
  past.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tournament-card';
    const title = document.createElement('h3');
    title.textContent = t.name;
    card.appendChild(title);
    const winnerEl = document.createElement('p');
    winnerEl.textContent = 'Winner: ' + t.winner;
    card.appendChild(winnerEl);
    // Show start date if available
    if (t.startDate) {
      const sd = new Date(t.startDate);
      const startEl = document.createElement('p');
      startEl.textContent = 'Started: ' + sd.toLocaleDateString();
      card.appendChild(startEl);
    }
    listEl.appendChild(card);
  });
}

/**
 * Render the list of pre‑site tournament champions. These champions come from
 * tournaments held before this site existed and are defined in STATIC_CHAMPIONS.
 * The section is always displayed if STATIC_CHAMPIONS is non‑empty.
 */
function renderStaticChampions() {
  const section = document.getElementById('past-champions-section');
  const listEl = document.getElementById('past-champions-list');
  if (!section || !listEl) return;
  listEl.innerHTML = '';
  if (!Array.isArray(STATIC_CHAMPIONS) || STATIC_CHAMPIONS.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  STATIC_CHAMPIONS.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'tournament-card';
    const title = document.createElement('h3');
    title.textContent = item.tournament;
    card.appendChild(title);
    const champEl = document.createElement('p');
    champEl.textContent = 'Champion: ' + item.champion;
    card.appendChild(champEl);
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
    // Prepare start date element if available; we'll append after team count for consistent ordering
    let startEl = null;
    if (t.startDate) {
      const sd = new Date(t.startDate);
      startEl = document.createElement('p');
      startEl.textContent = 'Starts: ' + sd.toLocaleDateString();
    }
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
    // Append start date after teams count, if present
    if (startEl) {
      card.appendChild(startEl);
    }
    card.appendChild(actions);
    listEl.appendChild(card);
  });
}

function createTournamentFromForm() {
  const nameInput = document.getElementById('tournament-name');
  const maxTeamsInput = document.getElementById('tournament-max-teams');
  // Start date input (optional)
  const dateInput = document.getElementById('tournament-start-date');
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
  // Create a new tournament object. Start date is optional; winner is initially null.
  const newTournament = {
    id,
    name,
    teams: [],
    maxTeams: maxVal,
    created: new Date().toISOString(),
    startDate: dateInput && dateInput.value ? dateInput.value : null,
    status: 'open',
    bracket: [],
    winner: null,
  };
  tournaments.push(newTournament);
  saveTournaments(tournaments);
  // Persist the new tournament to the back‑end. This call is fire‑and‑forget;
  // any network errors will be logged to the console. The backend expects
  // name, maxTeams and startDate in the request body.
  try {
    fetch(`${API_BASE_URL}/api/tournaments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        maxTeams: maxVal,
        startDate: newTournament.startDate,
      }),
    }).catch(() => {
      /* ignore errors */
    });
  } catch (err) {
    console.error('Failed to create tournament on backend:', err);
  }
  // Reset form fields
  nameInput.value = '';
  maxTeamsInput.value = '';
  if (dateInput) {
    dateInput.value = '';
  }
  // Optionally refresh from the back‑end so the local list uses the
  // canonical data and avoids duplicates. This call is fire‑and‑forget;
  // failures are ignored.
  if (typeof syncTournamentsFromBackend === 'function') {
    try {
      syncTournamentsFromBackend().catch(() => {
        /* ignore errors */
      });
    } catch (_) {
      /* ignore */
    }
  }
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
      // Prompt the admin to edit start date. Accept an empty value to clear the date.
      const newDate = prompt('Edit start date (YYYY-MM-DD):', t.startDate || '');
      if (newDate !== null) {
        const trimmedDate = newDate.trim();
        if (trimmedDate) {
          t.startDate = trimmedDate;
        } else {
          t.startDate = null;
        }
      }
    }
  } else {
    alert('Cannot edit maximum teams after the tournament has started.');
  }
  tournaments[index] = t;
  saveTournaments(tournaments);
  // Persist the updated tournament details to the back‑end. If a specific
  // update endpoint exists on the server, call it. Otherwise, attempt to
  // update via Supabase if the client is configured. We prefer calling
  // the REST API, but fall back to Supabase client update if available.
  (async () => {
    // Try REST API update if available
    try {
      await fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: t.name,
          maxTeams: t.maxTeams,
          startDate: t.startDate,
        }),
      });
    } catch (err) {
      // If fetch fails or no endpoint, try Supabase direct update
      if (supabaseClient) {
        try {
          await supabaseClient
            .from('tournaments')
            .update({
              name: t.name,
              max_teams: t.maxTeams,
              start_date: t.startDate || null,
            })
            .eq('id', id);
        } catch (e) {
          console.error('Failed to update tournament in Supabase:', e);
        }
      }
    }
  })();
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
  // Pass array of team names to bracket generator
  const teamNames = (t.teams || []).map((team) => (typeof team === 'string' ? team : team.name));
  t.bracket = generateBracket(teamNames);
  tournaments[index] = t;
  saveTournaments(tournaments);
  renderAdminTournaments();
  alert('Tournament started! The bracket has been generated.');
}

// Register the current user's team to a given tournament (by IDs)
function registerTeamToTournament(tournamentId, teamId) {
  let tournaments = loadTournaments();
  const idx = tournaments.findIndex((t) => t.id === tournamentId);
  if (idx === -1) return;
  const tournament = tournaments[idx];
  if (tournament.status === 'started') {
    alert('This tournament has already started and cannot accept new teams.');
    return;
  }
  if (!tournament.teams) tournament.teams = [];
  const max = tournament.maxTeams || Infinity;
  if (tournament.teams.length >= max) {
    alert('Tournament is full.');
    return;
  }
  // Check if team already registered
  if (tournament.teams.some((team) => team.id === teamId)) {
    alert('Your team is already registered for this tournament.');
    return;
  }
  // Find the team object to get its name
  const teams = loadTeams();
  const teamObj = teams.find((t) => t.id === teamId);
  if (!teamObj) {
    alert('Team not found.');
    return;
  }
  tournament.teams.push({ id: teamObj.id, name: teamObj.name });
  tournaments[idx] = tournament;
  saveTournaments(tournaments);
  // Persist the registration to the back‑end. We send the teamId in the body
  // and target the specific tournament endpoint. The request is non‑blocking;
  // any network errors are ignored to avoid disrupting the UI.
  try {
    fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(tournamentId)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: teamObj.id }),
    }).catch(() => {
      /* ignore errors */
    });
  } catch (err) {
    console.error('Failed to register team on backend:', err);
  }
  alert('Team registered successfully.');
  // Re-render details view (if on details page)
  // Note: caller should call renderTournamentDetails separately if needed
}

// Remove a team from a tournament (admin only)
function removeTeamFromTournament(tournamentId, teamId) {
  let tournaments = loadTournaments();
  const idx = tournaments.findIndex((t) => t.id === tournamentId);
  if (idx === -1) return;
  const tournament = tournaments[idx];
  if (tournament.status === 'started') {
    alert('Cannot remove teams after the tournament has started.');
    return;
  }
  if (tournament.teams) {
    tournament.teams = tournament.teams.filter((team) => team.id !== teamId);
    tournaments[idx] = tournament;
    saveTournaments(tournaments);
    alert('Team removed from tournament.');
  }
}

// Report a match result for a given tournament. Updates the winner and propagates
// the winner to the next round. Only called by admins.
function reportMatchResult(tournamentId, roundIndex, matchIndex, winnerName) {
  let tournaments = loadTournaments();
  const idx = tournaments.findIndex((t) => t.id === tournamentId);
  if (idx === -1) return;
  const tournament = tournaments[idx];
  const bracket = tournament.bracket;
  if (!bracket || !bracket[roundIndex] || !bracket[roundIndex][matchIndex]) return;
  const match = bracket[roundIndex][matchIndex];
  // Set the winner on the match
  match.winner = winnerName;
  // Propagate the winner to the next round, if there is one
  const nextRound = bracket[roundIndex + 1];
  if (nextRound) {
    const nextMatchIndex = Math.floor(matchIndex / 2);
    const nextMatch = nextRound[nextMatchIndex];
    if (nextMatch) {
      if (matchIndex % 2 === 0) {
        nextMatch.team1 = winnerName;
      } else {
        nextMatch.team2 = winnerName;
      }
    }
  }
  // If there is no next round, this was the final match. Mark the tournament as completed and set the winner.
  if (!nextRound) {
    tournament.winner = winnerName;
    tournament.status = 'completed';
  }
  tournaments[idx] = tournament;
  saveTournaments(tournaments);
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
  // Display start date if defined
  if (tournament.startDate) {
    const sd = new Date(tournament.startDate);
    const startP = document.createElement('p');
    startP.textContent = 'Start date: ' + sd.toLocaleDateString();
    detail.appendChild(startP);
  }
  // Display champion if tournament completed
  if (tournament.status === 'completed' && tournament.winner) {
    const champTitle = document.createElement('h3');
    champTitle.textContent = 'Champion: ' + tournament.winner;
    detail.appendChild(champTitle);
  }
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
      let name;
      if (typeof team === 'string') {
        name = team;
      } else {
        name = team.name;
      }
      // If admin, allow removing teams before tournament starts
      if (role === 'admin' && tournament.status !== 'started') {
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.className = 'delete';
        removeBtn.style.marginLeft = '0.5rem';
        removeBtn.addEventListener('click', function () {
          if (confirm('Remove this team from the tournament?')) {
            removeTeamFromTournament(tournament.id, team.id);
            // Re-render details to reflect changes
            renderTournamentDetails(tournament.id);
          }
        });
        li.appendChild(nameSpan);
        li.appendChild(removeBtn);
      } else {
        li.textContent = name;
      }
      teamsList.appendChild(li);
    });
    detail.appendChild(teamsHeading);
    detail.appendChild(teamsList);
  }

  // Allow non-admin users to register their team while the tournament is open
  if (role !== 'admin' && tournament.status !== 'started') {
    const maxCount = tournament.maxTeams || null;
    const currentCount = tournament.teams ? tournament.teams.length : 0;
    const currentTeam = getUserTeam();
    // If tournament is full
    if (maxCount && currentCount >= maxCount) {
      const fullMsg = document.createElement('p');
      fullMsg.textContent = 'Registration is full for this tournament.';
      detail.appendChild(fullMsg);
    } else if (!currentTeam) {
      // No team yet
      const noTeamMsg = document.createElement('p');
      noTeamMsg.textContent = 'You need to create a team before you can register.';
      detail.appendChild(noTeamMsg);
      const link = document.createElement('a');
      link.href = 'tournaments.html';
      link.textContent = 'Create a team here.';
      detail.appendChild(link);
    } else {
      // Check if current team is already registered
      const alreadyRegistered = tournament.teams && tournament.teams.some((team) => team.id === currentTeam.id);
      if (alreadyRegistered) {
        const registeredMsg = document.createElement('p');
        registeredMsg.textContent = 'Your team is already registered for this tournament.';
        detail.appendChild(registeredMsg);
      } else {
      const registerBtn = document.createElement('button');
        registerBtn.textContent = 'Register Your Team';
        registerBtn.className = 'button';
        registerBtn.style.marginTop = '1rem';
        registerBtn.addEventListener('click', function () {
          registerTeamToTournament(tournament.id, currentTeam.id);
          // After registering, refresh the details view to show updated team list and hide button
          renderTournamentDetails(tournament.id);
        });
        detail.appendChild(registerBtn);
      }
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
        // Title: show matchup
        const matchTitle = document.createElement('p');
        matchTitle.textContent = match.team1 + ' vs. ' + (match.team2 || 'BYE');
        matchDiv.appendChild(matchTitle);
        // Show winner if available
        if (match.winner) {
          const winnerEl = document.createElement('p');
          winnerEl.textContent = 'Winner: ' + match.winner;
          matchDiv.appendChild(winnerEl);
        }
        // Determine whether to show code
        let showCode = false;
        const currentTeam = getUserTeam();
        if (role === 'admin') {
          showCode = true;
        } else if (currentTeam) {
          const teamName = currentTeam.name;
          // Check if this user’s team is involved in the match
          if (match.team1 === teamName || match.team2 === teamName) {
            showCode = true;
          }
        }
        const codeEl = document.createElement('p');
        if (showCode) {
          codeEl.textContent = 'Match code: ' + match.code;
        } else {
          codeEl.textContent = 'Match code: (hidden)';
        }
        matchDiv.appendChild(codeEl);
        // Admin-only reporting controls
        if (
          role === 'admin' &&
          tournament.status === 'started' &&
          match.team1 && match.team1 !== 'BYE' &&
          match.team2 && match.team2 !== 'BYE' &&
          !match.winner
        ) {
          const reportDiv = document.createElement('div');
          reportDiv.className = 'report-score';
          const select = document.createElement('select');
          // default option
          const defOpt = document.createElement('option');
          defOpt.value = '';
          defOpt.textContent = 'Select winner';
          select.appendChild(defOpt);
          const opt1 = document.createElement('option');
          opt1.value = match.team1;
          opt1.textContent = match.team1;
          select.appendChild(opt1);
          const opt2 = document.createElement('option');
          opt2.value = match.team2;
          opt2.textContent = match.team2;
          select.appendChild(opt2);
          const reportBtn = document.createElement('button');
          reportBtn.textContent = 'Report Score';
          reportBtn.className = 'button';
          reportBtn.style.marginTop = '0.5rem';
          reportBtn.addEventListener('click', function () {
            const winnerName = select.value;
            if (!winnerName) {
              alert('Please select a winner.');
              return;
            }
            reportMatchResult(tournament.id, rIndex, mIndex, winnerName);
            // After updating, re-render details
            renderTournamentDetails(tournament.id);
          });
          reportDiv.appendChild(select);
          reportDiv.appendChild(reportBtn);
          matchDiv.appendChild(reportDiv);
        }
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