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

// Discord webhook localStorage keys — declared here so all functions can access them
// regardless of call order (const inside a module block would cause TDZ errors)
var WEBHOOK_KEYS = {
  results:       'webhook_results',
  champions:     'webhook_champions',
  submissions:   'webhook_submissions',
  registrations: 'webhook_registrations',
};

// === Seeded random helpers ===
// Simple deterministic random number generator. Given a seed (integer), returns
// a function that yields pseudo‑random numbers between 0 and 1. This allows
// bracket shuffling and code generation to be reproducible across devices.
function seededRng(seed) {
  let value = seed;
  return function () {
    // Linear congruential generator constants
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

// Convert a string seed into a numeric seed by summing char codes. If the
// input is already a number or can be parsed as one, use it directly.
function hashSeed(seed) {
  if (typeof seed === 'number') return seed;
  if (!seed) return 1;
  let num = parseInt(seed, 10);
  if (!isNaN(num)) return num;
  let total = 0;
  for (let i = 0; i < seed.length; i++) {
    total += seed.charCodeAt(i);
  }
  return total;
}

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

/**
 * Check whether the current user's profile record is complete. A profile is
 * considered complete when display_name, discord_handle and gamertag are all
 * non‑empty. If any of these fields are missing, the user will be redirected
 * to the profile page for completion. This function returns true if the
 * profile is complete or no Supabase client is available, and false if
 * redirection occurs.
 */
async function checkProfileCompletion() {
  // Only enforce profile completion when a Supabase client is configured
  if (!supabaseClient) {
    return true;
  }
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const user = session && session.user;
    if (!user) {
      // Not logged in; nothing to check
      return true;
    }
    // Query the profiles table for the current user
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('discord_handle, gamertag')
      .eq('id', user.id)
      .single();
    if (error) {
      console.warn('Error checking profile completion:', error.message || error);
      // Fail open; allow access rather than blocking due to query failure
      return true;
    }
    const displayName = data && (data.discord_handle || data.gamertag); // display_name removed
    const discord = data && data.discord_handle;
    const gamertag = data && data.gamertag;
    if (!discord || !gamertag) {
      // Redirect to profile page. Avoid infinite redirect loops by checking current page.
      const currentPage = window.location.pathname.split('/').pop();
      if (currentPage !== 'profile.html') {
        window.location.href = 'profile.html';
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to check profile completion:', err);
    // Fail open
    return true;
  }
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
      const transformed = [];
      for (const row of data) {
        const tournamentObj = {
          id: (row.id ?? '').toString(),
          name: row.name,
          teams: [],
          maxTeams: row.max_teams ?? row.maxTeams ?? null,
          startDate: row.start_date ?? row.startDate ?? null,
          status: row.status || 'open',
          created: row.created_at ?? row.created ?? new Date().toISOString(),
          bracket: Array.isArray(row.bracket) ? row.bracket : (row.bracket && typeof row.bracket === 'object' ? Object.values(row.bracket) : []),
          winner: row.winner || null,
          password: row.password || null,
        };
        // If we have a Supabase client, fetch registered teams for this tournament.
        if (supabaseClient) {
          try {
            // Get all team IDs registered for this tournament
            const { data: regs, error: regsErr } = await supabaseClient
              .from('tournament_registrations')
              .select('team_id')
              .eq('tournament_id', row.id);
            if (!regsErr && Array.isArray(regs) && regs.length > 0) {
              const teamIds = regs.map((r) => r.team_id);
              // Fetch team names for these IDs
              const { data: teamsData, error: teamsErr } = await supabaseClient
                .from('teams')
                .select('id,name')
                .in('id', teamIds);
              if (!teamsErr && Array.isArray(teamsData)) {
                tournamentObj.teams = teamsData.map((t) => ({
                  id: (t.id ?? '').toString(),
                  name: t.name,
                }));
              }
            }
          } catch (err) {
            console.error('Failed to fetch teams for tournament', row.id, err);
          }
        }
        transformed.push(tournamentObj);
      }
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
    // Invite by email removed — not needed
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
  const displayName = ''; // display name removed
  if (false) {
    alert('');
    return;
  }
  // If a Supabase client is configured, register the user via Supabase Auth.
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) {
        alert(error.message || 'Registration failed.');
        return;
      }
      // After successful sign up, insert or update the profile with display name
      // Use the returned user ID if available; otherwise fetch via getSession
      let userId = null;
      if (data && data.user && data.user.id) {
        userId = data.user.id;
      }
      if (!userId) {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        if (sessionData && sessionData.session && sessionData.session.user) {
          userId = sessionData.session.user.id;
        }
      }
      if (userId) {
        await supabaseClient.from('profiles').upsert({ id: userId, email: email });
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
    // displayName removed
    // Do not update password for security reasons
  } else {
    usersList.push({ email, password: '', role, displayName: '', discord: '', gamertag: '', teamId: null });
  }
  saveUsers(usersList);
  setCurrentUser(email);
  acceptInvitesForUser(email);
  alert('Registration successful! Please complete your profile.');
  // Always redirect new users to the profile page to finish filling details
  window.location.href = 'profile.html';
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
  // After login, enforce profile completion if using Supabase
  if (supabaseClient) {
    const ok = await checkProfileCompletion();
    if (!ok) {
      // Redirect triggered inside checkProfileCompletion
      return;
    }
  }
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
  // Show the profile nav item only when a user is logged in
  const profileNav = document.getElementById('profile-nav');
  if (profileNav) {
    profileNav.style.display = userEmail ? 'inline' : 'none';
    // Highlight active state if on profile page
    const currentPage = window.location.pathname.split('/').pop();
    if (userEmail && currentPage === 'profile.html') {
      profileNav.classList.add('active');
    } else if (profileNav.classList) {
      profileNav.classList.remove('active');
    }
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
      // Convert YYYY-MM-DD to a local date by appending a time portion. Without
      // this, Date() treats the string as UTC and may shift the date one day
      // earlier in some timezones. Using T00:00:00 ensures correct local display.
      const sd = new Date(t.startDate + 'T00:00:00');
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
 * Render active/open tournaments into the active tournaments tab. Active tournaments
 * are defined as those not started (status !== 'completed') where either
 * the start date is in the past or not defined. Started tournaments also
 * appear here. Each card shows a status badge indicating whether it is
 * Open, Full, Started or Completed, along with team counts and start date.
 */
function renderActiveTournaments() {
  const listEl = document.getElementById('active-tournaments-list');
  if (!listEl) return;
  const tournaments = loadTournaments();
  const now = new Date();
  const filtered = tournaments.filter((t) => {
    if (t.status === 'completed') return false;
    // Upcoming if a future start date exists
    if (t.startDate) {
      // Parse the start date as a local date to avoid timezone offsets.
      const sd = new Date(t.startDate + 'T00:00:00');
      if (sd > now) return false;
    }
    return true;
  });
  // Sort by creation date descending
  filtered.sort((a, b) => new Date(b.created) - new Date(a.created));
  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.textContent = 'No active tournaments.';
    listEl.appendChild(emptyMsg);
    return;
  }
  filtered.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tournament-card';
    // Status badge
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    let statusText;
    if (t.status === 'completed') {
      statusText = 'Completed';
    } else if (t.status === 'started') {
      statusText = 'Started';
    } else {
      const currentCount = t.teams ? t.teams.length : 0;
      const maxCount = t.maxTeams ? t.maxTeams : null;
      if (maxCount && currentCount >= maxCount) {
        statusText = 'Full';
      } else {
        statusText = 'Open';
      }
    }
    badge.classList.add('badge-' + statusText.toLowerCase());
    badge.textContent = statusText;
    card.appendChild(badge);
    const title = document.createElement('h3');
    title.textContent = t.name;
    card.appendChild(title);
    const teamsCount = document.createElement('p');
    const currentCount = t.teams ? t.teams.length : 0;
    const maxCount = t.maxTeams ? t.maxTeams : null;
    teamsCount.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
    card.appendChild(teamsCount);
    // Start date
    if (t.startDate) {
      // Parse the start date as a local date to avoid timezone offsets.
      // Append a time portion so the browser interprets it in the local timezone.
      const sd = new Date(t.startDate + 'T00:00:00');
      const startP = document.createElement('p');
      startP.textContent = 'Starts: ' + sd.toLocaleDateString();
      card.appendChild(startP);
    }
    const link = document.createElement('a');
    link.href = 'tournament.html?id=' + encodeURIComponent(t.id);
    link.className = 'button';
    link.textContent = 'View';
    card.appendChild(link);
    listEl.appendChild(card);
  });
}

/**
 * Render upcoming tournaments into the upcoming tab. An upcoming tournament
 * has a future start date and is not yet started or completed. The card
 * includes a status badge, teams count and start date.
 */
function renderUpcomingTournaments() {
  const listEl = document.getElementById('upcoming-tournaments-list');
  if (!listEl) return;
  const tournaments = loadTournaments();
  const now = new Date();
  const filtered = tournaments.filter((t) => {
    if (t.status === 'completed' || t.status === 'started') return false;
    if (!t.startDate) return false;
    const sd = new Date(t.startDate + 'T00:00:00');
    return sd > now;
  });
  // Sort by start date ascending
  // Sort by local start date ascending
  filtered.sort((a, b) => new Date(a.startDate + 'T00:00:00') - new Date(b.startDate + 'T00:00:00'));
  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.textContent = 'No upcoming tournaments.';
    listEl.appendChild(emptyMsg);
    return;
  }
  filtered.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tournament-card';
    // Status badge
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    let statusText;
    const currentCount = t.teams ? t.teams.length : 0;
    const maxCount = t.maxTeams ? t.maxTeams : null;
    if (maxCount && currentCount >= maxCount) {
      statusText = 'Full';
    } else {
      statusText = 'Open';
    }
    badge.classList.add('badge-' + statusText.toLowerCase());
    badge.textContent = statusText;
    card.appendChild(badge);
    const title = document.createElement('h3');
    title.textContent = t.name;
    card.appendChild(title);
    const teamsCount = document.createElement('p');
    teamsCount.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
    card.appendChild(teamsCount);
    if (t.startDate) {
      // Use local parsing for the date.
      const sd = new Date(t.startDate + 'T00:00:00');
      const startP = document.createElement('p');
      startP.textContent = 'Starts: ' + sd.toLocaleDateString();
      card.appendChild(startP);
    }
    const link = document.createElement('a');
    link.href = 'tournament.html?id=' + encodeURIComponent(t.id);
    link.className = 'button';
    link.textContent = 'View';
    card.appendChild(link);
    listEl.appendChild(card);
  });
}

/**
 * Render past champions into the past tab. This includes both tournaments
 * completed via this site (past winners) and the static champions list.
 * Past winners show tournament name and champion team; static champions
 * also include these details. Distinct styling for trophy cards is applied
 * via CSS classes.
 */
function renderPastChampionsTab() {
  const pastList = document.getElementById('past-champions-tab-list');
  const staticList = document.getElementById('static-champions-tab-list');
  if (!pastList || !staticList) return;
  // Clear current contents
  pastList.innerHTML = '';
  staticList.innerHTML = '';
  // Past winners from site tournaments
  const tournaments = loadTournaments();
  const past = tournaments.filter((t) => t.status === 'completed' && t.winner);
  // Sort past tournaments by creation date descending
  past.sort((a, b) => new Date(b.created) - new Date(a.created));
  past.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tournament-card past-champion-card';
    const title = document.createElement('h3');
    title.textContent = t.name;
    card.appendChild(title);
    const champ = document.createElement('p');
    champ.textContent = 'Champion: ' + t.winner;
    card.appendChild(champ);
    // Admin delete button on past champion cards
    const role = getCurrentUserRole();
    if (role === 'admin') {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'delete';
      deleteBtn.style.marginTop = '0.5rem';
      deleteBtn.addEventListener('click', function() {
        deleteTournament(t.id);
        renderPastChampionsTab();
      });
      card.appendChild(deleteBtn);
    }
    pastList.appendChild(card);
  });
  // Static champions defined before the site
  if (Array.isArray(STATIC_CHAMPIONS)) {
    STATIC_CHAMPIONS.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'tournament-card past-champion-card';
      const title = document.createElement('h3');
      title.textContent = item.tournament;
      card.appendChild(title);
      const champ = document.createElement('p');
      champ.textContent = 'Champion: ' + item.champion;
      card.appendChild(champ);
      staticList.appendChild(card);
    });
  }
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
      // Parse start date as local date to avoid timezone issues
      const sd = new Date(t.startDate + 'T00:00:00');
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
      // Use local parsing for the date to avoid UTC offset issues
      const sd = new Date(t.startDate + 'T00:00:00');
      startEl = document.createElement('p');
      startEl.textContent = 'Starts: ' + sd.toLocaleDateString();
    }
    // Display max teams explicitly (optional)
    // const maxTeamsEl = document.createElement('p');
    // maxTeamsEl.textContent = 'Max teams: ' + (t.maxTeams || '—');
    // Actions
    const actions = document.createElement('div');
    actions.className = 'admin-actions';
    // Start button - hide on completed, disable on started
    const startBtn = document.createElement('button');
    startBtn.className = 'start';
    if (t.status === 'completed') {
      startBtn.textContent = 'Completed';
      startBtn.disabled = true;
      startBtn.style.opacity = '0.4';
    } else if (t.status === 'started') {
      startBtn.textContent = 'Started';
      startBtn.disabled = true;
    } else {
      startBtn.textContent = 'Start';
      startBtn.addEventListener('click', () => { startTournament(t.id); });
    }
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

/**
 * Render a list of all registered users (by email and Discord handle) for the
 * admin dashboard. This function will attempt to fetch the data from a
 * Supabase `profiles` table first if a Supabase client is configured. If
 * that fails or no data is returned, it falls back to the local `users`
 * list stored in the browser. The list is rendered into the element with
 * ID `users-list` on admin.html.
 */
async function renderAdminUsers() {
  const tbody = document.getElementById('admin-users-table-body');
  if (!tbody) return;
  let usersArray = [];
  // Always fetch from Supabase `profiles` table. We no longer use localStorage as fallback.
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('profiles').select('email, discord_handle, gamertag, created_at');
      if (!error && Array.isArray(data) && data.length > 0) {
        usersArray = data.map((row) => ({
          email: (row.email || '').toLowerCase(),
          discord: row.discord_handle || '',
          display_name: row.discord_handle || row.gamertag || '',
          gamertag: row.gamertag || '',
          created_at: row.created_at || null,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch profiles from Supabase:', err);
    }
  }
  // Sort by email
  usersArray.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  // Render table rows
  tbody.innerHTML = '';
  if (usersArray.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = 'No users found.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  usersArray.forEach((u) => {
    const tr = document.createElement('tr');
    const emailTd = document.createElement('td');
    emailTd.textContent = u.email;
    const discordTd = document.createElement('td');
    discordTd.textContent = u.discord || 'Not set';
    const nameTd = document.createElement('td');
    nameTd.textContent = u.display_name || '-';
    const gamertagTd = document.createElement('td');
    gamertagTd.textContent = u.gamertag || '-';
    const dateTd = document.createElement('td');
    if (u.created_at) {
      const d = new Date(u.created_at);
      dateTd.textContent = d.toLocaleDateString();
    } else {
      dateTd.textContent = '-';
    }
    // Delete user button
    const deleteTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'delete';
    deleteBtn.style.fontSize = '0.75rem';
    deleteBtn.addEventListener('click', async function() {
      if (!confirm('Delete user ' + u.email + '? This cannot be undone.')) return;
      if (supabaseClient) {
        await supabaseClient.from('profiles').delete().eq('email', u.email);
      }
      renderAdminUsers();
    });
    deleteTd.appendChild(deleteBtn);
    tr.appendChild(emailTd);
    tr.appendChild(discordTd);
    tr.appendChild(nameTd);
    tr.appendChild(gamertagTd);
    tr.appendChild(dateTd);
    tr.appendChild(deleteTd);
    tbody.appendChild(tr);
  });
}

/**
 * Render a list of all registered teams for the admin dashboard, including
 * the Discord handle of each team captain if available. This function
 * synchronises teams from the back‑end first (if configured) and then
 * reads teams from local storage. It also loads user data to map
 * captain emails to Discord handles. The result is rendered into the
 * element with ID `admin-teams-list` on admin.html.
 */
async function renderAdminTeams() {
  const tbody = document.getElementById('admin-teams-table-body');
  if (!tbody) return;
  // Fetch teams directly from Supabase if available
  let teamsArray = [];
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('teams').select('id, name, captain, members');
      if (!error && Array.isArray(data) && data.length > 0) {
        teamsArray = data;
      }
    } catch (err) {
      console.error('Failed to fetch teams from Supabase:', err);
    }
  }
  // Fetch user discord map from Supabase
  let discordMap = {};
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('profiles').select('email, discord_handle');
      if (!error && Array.isArray(data) && data.length > 0) {
        data.forEach((row) => {
          const email = (row.email || '').toLowerCase();
          discordMap[email] = row.discord_handle || '';
        });
      }
    } catch (err) {
      console.error('Failed to fetch profiles from Supabase:', err);
    }
  }
  // Render table rows
  tbody.innerHTML = '';
  if (teamsArray.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4; // Team Name, Email, Discord, Actions
    td.textContent = 'No teams found.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  // Sort by name
  teamsArray.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  teamsArray.forEach((team) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = team.name;
    const captainTd = document.createElement('td');
    captainTd.textContent = team.captain || '';
    const discordTd = document.createElement('td');
    const emailKey = (team.captain || '').toLowerCase();
    const discordVal = discordMap[emailKey] || '';
    discordTd.textContent = discordVal || '—';
    // Delete team button
    const deleteTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'delete';
    deleteBtn.style.fontSize = '0.75rem';
    deleteBtn.addEventListener('click', async function() {
      if (!confirm('Delete team "' + team.name + '"? This cannot be undone.')) return;
      try {
        await fetch(API_BASE_URL + '/api/teams/' + encodeURIComponent(team.id), { method: 'DELETE' })
          .catch(() => {});
        if (supabaseClient) {
          await supabaseClient.from('teams').delete().eq('id', team.id);
        }
        // Also remove from local teams list
        const localTeams = loadTeams().filter(t => t.id !== team.id);
        saveTeams(localTeams);
      } catch(e) { console.error(e); }
      renderAdminTeams();
    });
    deleteTd.appendChild(deleteBtn);
    tr.appendChild(nameTd);
    tr.appendChild(captainTd);
    tr.appendChild(discordTd);
    tr.appendChild(deleteTd);
    tbody.appendChild(tr);
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
  const passwordInput = document.getElementById('tournament-password');
  const tournamentPassword = passwordInput && passwordInput.value.trim() ? passwordInput.value.trim() : null;
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
    password: tournamentPassword,
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
        password: newTournament.password || null,
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
  if (passwordInput) {
    passwordInput.value = '';
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
  // Remove from local storage first.
  let tournaments = loadTournaments();
  tournaments = tournaments.filter((t) => t.id !== id);
  saveTournaments(tournaments);
  // Attempt to delete from the back‑end. This ensures the tournament is removed globally.
  try {
    fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
      .then(() => {
        // After deletion, re‑sync tournaments to update local state from server.
        if (typeof syncTournamentsFromBackend === 'function') {
          syncTournamentsFromBackend().catch(() => {});
        }
      })
      .catch(() => {
        /* ignore errors */
      });
  } catch (err) {
    console.error('Failed to delete tournament on backend:', err);
  }
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
  // Pass array of team names to the bracket generator with a seed equal to the tournament id.
  let teamNames = (t.teams || []).map((team) => (typeof team === 'string' ? team : team.name));
  // Sort team names to ensure deterministic bracket seed across devices
  teamNames = teamNames.slice().sort((a, b) => a.localeCompare(b));
  t.bracket = generateBracket(teamNames, id);
  tournaments[index] = t;
  saveTournaments(tournaments);
  // Persist the tournament start state to the back‑end by setting its status to 'started'.
  try {
    fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'started' }),
    }).catch(() => {
      /* ignore errors */
    });
  } catch (err) {
    console.error('Failed to update tournament status on backend:', err);
  }
  renderAdminTournaments();
  // Post bracket to Discord (match codes hidden)
  try { announceBracketGenerated(t.name, t.bracket); } catch(_) {}
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
  // Password check
  if (tournament.password) {
    const entered = prompt('This tournament is password protected. Enter the password to register:');
    if (!checkTournamentPassword(tournament, entered)) {
      alert('Incorrect password.');
      return;
    }
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
  // After registering the team on the server, refresh tournaments from
  // the back‑end so that the local state picks up the canonical data
  // (including team registrations). This call is fire‑and‑forget;
  // failures are ignored to keep the UI responsive.
  if (typeof syncTournamentsFromBackend === 'function') {
    try {
      syncTournamentsFromBackend().catch(() => {
        /* ignore errors */
      });
    } catch (_) {
      /* ignore */
    }
  }
  // Notify Discord registrations channel — fire and forget
  (function() {
    try {
      const regWhUrl = localStorage.getItem('webhook_registrations');
      console.log('[Webhook] Registration firing. URL saved?', !!regWhUrl, '| Team:', teamObj.name);
      const tObj = loadTournaments().find(function(x) { return x.id === tournamentId; });
      const tName = tObj ? tObj.name : String(tournamentId);
      const total = tObj && tObj.teams ? tObj.teams.length : 1;
      const max = tObj ? (tObj.max_teams || tObj.maxTeams || '?') : '?';
      console.log('[Webhook] Registration params — team:', teamObj.name, 'tournament:', tName, 'total:', total, 'max:', max);
      announceTeamRegistration(teamObj.name, tName, total, max).catch(function(e) {
        console.warn('[Webhook] Registration webhook error:', e);
      });
    } catch(regWhErr) {
      console.warn('[Webhook] Registration webhook setup error:', regWhErr);
    }
  })();
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
    // Remove from local state
    tournament.teams = tournament.teams.filter((team) => team.id !== teamId);
    tournaments[idx] = tournament;
    saveTournaments(tournaments);
    // Attempt to remove the registration on the back‑end so the change persists.
    try {
      fetch(
        `${API_BASE_URL}/api/tournaments/${encodeURIComponent(
          tournamentId
        )}/register/${encodeURIComponent(teamId)}`,
        {
          method: 'DELETE',
        }
      )
        .then(() => {
          // After deletion, re‑sync tournaments from the server to ensure local state matches.
          if (typeof syncTournamentsFromBackend === 'function') {
            syncTournamentsFromBackend().catch(() => {});
          }
        })
        .catch(() => {
          /* ignore errors */
        });
    } catch (err) {
      console.error('Failed to remove team registration on backend:', err);
    }
    alert('Team removed from tournament.');
  }
}

// Report a match result for a given tournament. Updates the winner and propagates
// the winner to the next round. Only called by admins.
async function reportMatchResult(tournamentId, roundIndex, matchIndex, winnerName, t1Score, t2Score) {
  let tournaments = loadTournaments();
  const idx = tournaments.findIndex((t) => t.id === tournamentId);
  if (idx === -1) return;
  const tournament = tournaments[idx];
  const bracket = tournament.bracket;
  if (!bracket || !bracket[roundIndex] || !bracket[roundIndex][matchIndex]) return;
  const match = bracket[roundIndex][matchIndex];
  // Delete chat messages for this match since it's now over
  if (match.code) {
    deleteMatchMessages(match.code);
    if (activeChatSubscriptions[match.code]) {
      try { activeChatSubscriptions[match.code].unsubscribe(); } catch(e) {}
      delete activeChatSubscriptions[match.code];
    }
  }
  // Set the winner on the match
  match.winner = winnerName;
  // Save to match history and send Discord announcement
  saveMatchToHistory(tournamentId, tournament.name, roundIndex, match, winnerName);
  announceMatchResult(tournament.name, match.team1, match.team2, winnerName, t1Score, t2Score);
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
    announceTournamentComplete(tournament.name, winnerName);
  }
  tournaments[idx] = tournament;
  saveTournaments(tournaments);
  // Persist the updated bracket, status and winner to the backend so
  // changes survive page reloads and are visible to all users globally.
  const patchBody = {
    bracket: tournament.bracket,
    status: tournament.status,
  };
  if (tournament.winner) {
    patchBody.winner = tournament.winner;
  }
  try {
    const patchRes = await fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    const patchData = await patchRes.json();
    if (!patchData.ok) {
      console.error('Backend failed to save match result:', patchData);
      alert('Warning: match result may not have saved. Please try again.');
    }
  } catch (err) {
    console.error('Failed to persist match result to backend:', err);
    alert('Warning: could not reach backend. Match result may not have saved.');
  }
}



// ── EMOJI AVATARS ─────────────────────────────────────────────────────────────
const AVATARS = [
  // Animals
  { id: 'wolf',      label: 'Wolf',      emoji: '🐺' },
  { id: 'bear',      label: 'Bear',      emoji: '🐻' },
  { id: 'eagle',     label: 'Eagle',     emoji: '🦅' },
  { id: 'shark',     label: 'Shark',     emoji: '🦈' },
  { id: 'lion',      label: 'Lion',      emoji: '🦁' },
  { id: 'fox',       label: 'Fox',       emoji: '🦊' },
  { id: 'tiger',     label: 'Tiger',     emoji: '🐯' },
  { id: 'dragon',    label: 'Dragon',    emoji: '🐉' },
  { id: 'rhino',     label: 'Rhino',     emoji: '🦏' },
  { id: 'bull',      label: 'Bull',      emoji: '🐂' },
  { id: 'gorilla',   label: 'Gorilla',   emoji: '🦍' },
  { id: 'panther',   label: 'Panther',   emoji: '🐆' },
  { id: 'cobra',     label: 'Cobra',     emoji: '🐍' },
  { id: 'croc',      label: 'Croc',      emoji: '🐊' },
  { id: 'boar',      label: 'Boar',      emoji: '🐗' },
  { id: 'ram',       label: 'Ram',       emoji: '🐏' },
  { id: 'bat',       label: 'Bat',       emoji: '🦇' },
  { id: 'octopus',   label: 'Octopus',   emoji: '🐙' },
  { id: 'scorpion',  label: 'Scorpion',  emoji: '🦂' },
  { id: 'wolverine', label: 'Wolverine', emoji: '🦡' },
  { id: 'mammoth',   label: 'Mammoth',   emoji: '🦣' },
  { id: 'bison',     label: 'Bison',     emoji: '🦬' },
  { id: 'moose',     label: 'Moose',     emoji: '🫎' },
  { id: 'penguin',   label: 'Penguin',   emoji: '🐧' },
  { id: 'polar',     label: 'Polar Bear',emoji: '🐻‍❄️' },
  // Hockey & Sports
  { id: 'stick',     label: 'Stick',     emoji: '🏒' },
  { id: 'net',       label: 'Net',       emoji: '🥅' },
  { id: 'trophy',    label: 'Trophy',    emoji: '🏆' },
  { id: 'thunder',   label: 'Thunder',   emoji: '⚡' },
  { id: 'skull',     label: 'Skull',     emoji: '💀' },
  { id: 'flame',     label: 'Flame',     emoji: '🔥' },
  { id: 'ice',       label: 'Ice',       emoji: '❄️' },
  { id: 'target',    label: 'Target',    emoji: '🎯' },
  { id: 'crown',     label: 'Crown',     emoji: '👑' },
  { id: 'shield',    label: 'Shield',    emoji: '🛡️' },
  { id: 'sword',     label: 'Sword',     emoji: '⚔️' },
  { id: 'bomb',      label: 'Bomb',      emoji: '💣' },
  { id: 'rocket',    label: 'Rocket',    emoji: '🚀' },
  { id: 'diamond',   label: 'Diamond',   emoji: '💎' },
  { id: 'fist',      label: 'Fist',      emoji: '👊' },
  { id: 'ghost',     label: 'Ghost',     emoji: '👻' },
  { id: 'alien',     label: 'Alien',     emoji: '👾' },
  { id: 'robot',     label: 'Robot',     emoji: '🤖' },
  { id: 'demon',     label: 'Demon',     emoji: '😈' },
  { id: 'medalmilitary', label: 'Medal', emoji: '🎖️' },
  { id: 'comet',     label: 'Comet',     emoji: '☄️' },
  { id: 'trident',   label: 'Trident',   emoji: '🔱' },
  { id: 'tornado',   label: 'Tornado',   emoji: '🌪️' },
  { id: 'lightning', label: 'Lightning', emoji: '🌩️' },
];


function getAvatarEmoji(id) {
  const av = AVATARS.find(a => a.id === id) || AVATARS[0];
  return av.emoji;
}

// Renders an emoji avatar badge with a background color
// color defaults to dark if not provided
function renderAvatarSVG(id, size = 48, color) {
  const emoji = getAvatarEmoji(id);
  const bg = color || '#1a1a2e';
  const fontSize = Math.round(size * 0.55);
  return `<div class="avatar-emoji-badge" style="width:${size}px;height:${size}px;font-size:${fontSize}px;background:${bg};">${emoji}</div>`;
}

function getAvatarSVGString(id, size, color) {
  return renderAvatarSVG(id, size, color);
}

// ── ACHIEVEMENTS SYSTEM ──────────────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { id: 'first_tournament', icon: '🎯', label: 'First Tournament', desc: 'Entered your first tournament' },
  { id: 'first_win',        icon: '🥇', label: 'First Win',        desc: 'Won your first match' },
  { id: 'champion',         icon: '🏆', label: 'Champion',         desc: 'Won a tournament' },
  { id: 'back_to_back',     icon: '🔁', label: 'Back to Back',     desc: 'Won 2 tournaments in a row' },
  { id: 'dynasty',          icon: '👑', label: 'Dynasty',          desc: 'Won 3 or more tournaments' },
  { id: 'undefeated',       icon: '⚡', label: 'Undefeated Run',   desc: 'Won a tournament without dropping a match' },
  { id: 'shutout_king',     icon: '💀', label: 'Shutout King',     desc: 'Won a match with 0 goals against' },
  { id: 'on_a_streak',      icon: '📈', label: 'On a Streak',      desc: 'Won 3 matches in a row' },
  { id: 'ice_cold',         icon: '🧊', label: 'Ice Cold',         desc: 'Reached a tournament final' },
  { id: 'giant_killer',     icon: '🔨', label: 'Giant Killer',     desc: 'Beat the #1 ranked team' },
];

function computeAchievements(teamName) {
  const tournaments = loadTournaments();
  const earned = new Set();

  let totalWins = 0;
  let consecutiveTournamentWins = 0;
  let lastTournamentWon = false;
  let streak = 0;
  let champCount = 0;

  const entered = tournaments.filter(t =>
    t.bracket && t.bracket.some(round =>
      round.some(m => m.team1 === teamName || m.team2 === teamName)
    )
  );

  if (entered.length > 0) earned.add('first_tournament');

  entered.forEach(t => {
    if (!t.bracket) return;

    let teamWinsThisTournament = 0;
    let teamLossesThisTournament = 0;
    let reachedFinal = false;

    t.bracket.forEach((round, rIdx) => {
      round.forEach(m => {
        if (!m.winner) return;
        const inMatch = m.team1 === teamName || m.team2 === teamName;
        if (!inMatch) return;
        if (m.winner === teamName) {
          teamWinsThisTournament++;
          totalWins++;
          streak++;
          if (streak === 1) earned.add('first_win');
          if (streak >= 3) earned.add('on_a_streak');
          // Check shutout (score tracking - if goals_against stored later)
        } else {
          teamLossesThisTournament++;
          streak = 0;
          // Reached final = lost in last round
          if (rIdx === t.bracket.length - 1) reachedFinal = true;
        }
      });
    });

    if (reachedFinal) earned.add('ice_cold');

    if (t.status === 'completed' && t.winner === teamName) {
      champCount++;
      earned.add('champion');
      if (teamLossesThisTournament === 0) earned.add('undefeated');
      if (lastTournamentWon) {
        consecutiveTournamentWins++;
        if (consecutiveTournamentWins >= 1) earned.add('back_to_back');
      } else {
        consecutiveTournamentWins = 0;
      }
      lastTournamentWon = true;
    } else {
      lastTournamentWon = false;
    }
  });

  if (champCount >= 3) earned.add('dynasty');

  // Giant killer: beat a team that leads the leaderboard
  // Simple check: beat any team that has more championships
  // (full implementation would need leaderboard data)

  return ACHIEVEMENT_DEFS.filter(a => earned.has(a.id));
}

// ── TEAM PAGE ────────────────────────────────────────────────────────────────
async function renderTeamPage(teamId) {
  const container = document.getElementById('team-page-container');
  if (!container) return;

  if (!teamId) {
    container.innerHTML = '<div class="container"><p style="color:var(--text-muted);padding:3rem 0">No team specified.</p></div>';
    return;
  }

  const teams = loadTeams();
  const team = teams.find(t => t.id === teamId);

  if (!team) {
    container.innerHTML = '<div class="container"><p style="color:var(--text-muted);padding:3rem 0">Team not found.</p></div>';
    return;
  }

  // Load avatar/banner from Supabase profiles if captain exists
  let avatarId = team.avatar || 'wolf';
  let bannerColor = team.banner_color || '#1a1a2e';
  let captainGamertag = '';
  let captainPlatform = 'ps5';
  let captainDiscord = '';

  if (supabaseClient && team.captain) {
    try {
      const { data } = await supabaseClient
        .from('profiles')
        .select('avatar, banner_color, platform, gamertag, discord_handle')
        .eq('email', team.captain)
        .single();
      if (data) {
        avatarId = data.avatar || avatarId;
        bannerColor = data.banner_color || bannerColor;
        const avatarColor = data.avatar_color || '#1a1a2e';
        captainGamertag = data.gamertag || '';
        captainPlatform = data.platform || 'ps5';
        captainDiscord = data.discord_handle || '';
      }
    } catch(e) {}
  }

  const achievements = computeAchievements(team.name);
  const tournaments = loadTournaments();

  // Stats from leaderboard data
  let wins = 0, losses = 0, championships = 0, entered = 0;
  tournaments.forEach(t => {
    if (!t.bracket) return;
    let inThisTournament = false;
    t.bracket.forEach(round => round.forEach(m => {
      if (m.team1 === team.name || m.team2 === team.name) inThisTournament = true;
      if (!m.winner) return;
      if (m.team1 === team.name || m.team2 === team.name) {
        if (m.winner === team.name) wins++;
        else losses++;
      }
    }));
    if (inThisTournament) entered++;
    if (t.status === 'completed' && t.winner === team.name) championships++;
  });
  const winPct = wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : 0;

  // Match history — load from Supabase if available, fall back to local brackets
  let matchHistory = [];
  if (supabaseClient) {
    matchHistory = await loadTeamMatchHistory(team.name);
    matchHistory = matchHistory.map(m => ({
      tournamentName: m.tournament_name,
      opponent: m.team1 === team.name ? m.team2 : m.team1,
      won: m.winner === team.name,
      code: m.match_code,
    }));
  } else {
    tournaments.forEach(t => {
      if (!t.bracket) return;
      t.bracket.forEach(round => round.forEach(m => {
        if (!m.winner) return;
        if (m.team1 === team.name || m.team2 === team.name) {
          const won = m.winner === team.name;
          const opponent = m.team1 === team.name ? m.team2 : m.team1;
          matchHistory.push({ tournamentName: t.name, opponent, won, code: m.code });
        }
      }));
    });
  }

  const platformIcon = captainPlatform === 'xbox'
    ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm3.5 4.5c.83.9 1.33 2.1 1.33 3.5 0 .54-.08 1.06-.22 1.55L10 7.5l2.5-3zm-7 0L7 7.5 4.89 9.55A5.48 5.48 0 014.67 8c0-1.4.5-2.6 1.33-3.5zM8 3c.74 0 1.85.9 2.76 2.24L8 7.5 5.24 5.24C6.15 3.9 7.26 3 8 3zm0 10c-1.54 0-2.93-.62-3.95-1.63L8 8.5l3.95 2.87A5.5 5.5 0 018 13z"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm-1 11.5H5.5v-5H7v5zm3 0H8.5v-5H10v5zM8 5.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"/></svg>`;

  container.innerHTML = '';

  // Banner
  const banner = document.createElement('div');
  banner.className = 'team-banner';
  banner.style.background = `linear-gradient(135deg, ${bannerColor} 0%, #0a0a0a 100%)`;

  const bannerInner = document.createElement('div');
  bannerInner.className = 'team-banner-inner container';

  const avatarEl = document.createElement('div');
  avatarEl.className = 'team-avatar-large';
  avatarEl.innerHTML = renderAvatarSVG(avatarId, 96, typeof avatarColor !== 'undefined' ? avatarColor : '#1a1a2e');

  const teamInfo = document.createElement('div');
  teamInfo.className = 'team-banner-info';

  const nameEl = document.createElement('h1');
  nameEl.className = 'team-banner-name';
  nameEl.textContent = team.name;

  const captainEl = document.createElement('p');
  captainEl.className = 'team-banner-captain';
  captainEl.innerHTML = `${platformIcon} <span>${captainGamertag || team.captain}</span>`;
  if (captainDiscord) {
    const disc = document.createElement('span');
    disc.className = 'team-banner-discord';
    disc.textContent = ' · ' + captainDiscord;
    captainEl.appendChild(disc);
  }

  teamInfo.appendChild(nameEl);
  teamInfo.appendChild(captainEl);
  bannerInner.appendChild(avatarEl);
  bannerInner.appendChild(teamInfo);
  banner.appendChild(bannerInner);
  container.appendChild(banner);

  // Stats bar
  const statsBar = document.createElement('div');
  statsBar.className = 'team-stats-bar container';
  [
    { label: '🏆 Championships', val: championships },
    { label: 'Wins', val: wins },
    { label: 'Losses', val: losses },
    { label: 'Win %', val: winPct + '%' },
    { label: 'Tournaments', val: entered },
  ].forEach(s => {
    const stat = document.createElement('div');
    stat.className = 'team-stat-item';
    stat.innerHTML = `<span class="team-stat-val">${s.val}</span><span class="team-stat-label">${s.label}</span>`;
    statsBar.appendChild(stat);
  });
  container.appendChild(statsBar);

  const content = document.createElement('div');
  content.className = 'container team-page-content';

  // Achievements
  if (achievements.length > 0) {
    const achSection = document.createElement('div');
    achSection.className = 'team-section-block';
    const achTitle = document.createElement('h2');
    achTitle.className = 'team-section-title';
    achTitle.textContent = 'Achievements';
    achSection.appendChild(achTitle);
    const achGrid = document.createElement('div');
    achGrid.className = 'achievements-grid';
    achievements.forEach(a => {
      const badge = document.createElement('div');
      badge.className = 'achievement-badge';
      badge.innerHTML = `<span class="ach-icon">${a.icon}</span><span class="ach-label">${a.label}</span><span class="ach-desc">${a.desc}</span>`;
      achGrid.appendChild(badge);
    });
    achSection.appendChild(achGrid);
    content.appendChild(achSection);
  }

  // Match History
  if (matchHistory.length > 0) {
    const histSection = document.createElement('div');
    histSection.className = 'team-section-block';
    const histTitle = document.createElement('h2');
    histTitle.className = 'team-section-title';
    histTitle.textContent = 'Match History';
    histSection.appendChild(histTitle);
    const histList = document.createElement('div');
    histList.className = 'match-history-list';
    matchHistory.forEach(m => {
      const row = document.createElement('div');
      row.className = 'match-history-row ' + (m.won ? 'won' : 'lost');
      row.innerHTML = `
        <span class="mh-result">${m.won ? 'W' : 'L'}</span>
        <span class="mh-opponent">vs <strong>${m.opponent}</strong></span>
        <span class="mh-tournament">${m.tournamentName}</span>
      `;
      histList.appendChild(row);
    });
    histSection.appendChild(histList);
    content.appendChild(histSection);
  }

  if (achievements.length === 0 && matchHistory.length === 0) {
    const empty = document.createElement('p');
    empty.style.color = 'var(--text-muted)';
    empty.style.padding = '2rem 0';
    empty.textContent = 'No match history yet. Enter a tournament to get started!';
    content.appendChild(empty);
  }

  container.appendChild(content);

  // Edit button — only visible to captain
  const currentEmail = getCurrentUser();
  if (currentEmail && currentEmail === team.captain) {
    const editBtn = document.createElement('a');
    editBtn.href = 'profile.html';
    editBtn.className = 'button team-edit-btn';
    editBtn.textContent = 'Edit Team Profile';
    banner.appendChild(editBtn);
  }
}

// ── PROFILE PAGE (Phase 1 editor) ────────────────────────────────────────────
async function loadProfile() {
  if (!supabaseClient) return;
  const email = getCurrentUser();
  if (!email) return;
  try {
    const { data } = await supabaseClient
      .from('profiles')
      .select('discord_handle, gamertag, avatar, avatar_color, banner_color, platform')
      .eq('email', email)
      .single();
    if (!data) return;
    const dn = null; // display_name field removed
    const dc = document.getElementById('profile-discord');
    const gt = document.getElementById('profile-gamertag');
    // display_name removed
    if (dc) dc.value = data.discord_handle || '';
    if (gt) gt.value = data.gamertag || '';
    // Set avatar color
    const avColor = data.avatar_color || '#1a1a2e';
    const avColorInput = document.getElementById('profile-avatar-color');
    if (avColorInput) avColorInput.value = avColor;
    document.querySelectorAll('.avatar-color-swatch').forEach(el => {
      el.classList.toggle('active', el.dataset.color === avColor);
    });
    // Set avatar picker
    if (data.avatar) {
      document.querySelectorAll('.avatar-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.avatar === data.avatar);
        el.innerHTML = renderAvatarSVG(el.dataset.avatar, 44, avColor);
      });
      const previewAv = document.getElementById('preview-avatar');
      if (previewAv) previewAv.innerHTML = renderAvatarSVG(data.avatar, 64, avColor);
    }
    // Set banner color
    if (data.banner_color) {
      const bc = document.getElementById('profile-banner-color');
      if (bc) bc.value = data.banner_color;
      updateBannerPreview(data.banner_color);
      document.querySelectorAll('.color-swatch:not(.avatar-color-swatch)').forEach(el => {
        el.classList.toggle('active', el.dataset.color === data.banner_color);
      });
    }
    // Set platform
    if (data.platform) {
      document.querySelectorAll('.platform-btn').forEach(el => {
        el.classList.toggle('active', el.dataset.platform === data.platform);
      });
    }
  } catch(e) { console.error('loadProfile error', e); }

  // Wire the View Team Page button to the user's team
  try {
    const email = getCurrentUser();
    if (email && supabaseClient) {
      const { data: teamData } = await supabaseClient
        .from('teams')
        .select('id')
        .eq('captain', email)
        .single();
      const btn = document.getElementById('view-team-page-btn');
      if (btn && teamData?.id) {
        btn.href = 'team.html?id=' + teamData.id;
      } else if (btn) {
        btn.style.display = 'none'; // hide if no team yet
      }
    }
  } catch(e) { /* no team yet */ }
}

async function handleProfileSave() {
  if (!supabaseClient) { alert('Profile updates require Supabase.'); return; }
  const displayName = ''; // display_name removed
  const discord = document.getElementById('profile-discord')?.value.trim();
  const gamertag = document.getElementById('profile-gamertag')?.value.trim();
  if (!discord || !gamertag) { alert('Please fill out Discord handle and Gamertag.'); return; }

  const selectedAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar || 'wolf';
  const avatarColor = document.getElementById('profile-avatar-color')?.value || '#1a1a2e';
  const bannerColor = document.getElementById('profile-banner-color')?.value || '#1a1a2e';
  const platform = document.querySelector('.platform-btn.active')?.dataset.platform || 'ps5';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const user = session && session.user;
    if (!user) { alert('Not logged in.'); return; }
    const { error } = await supabaseClient.from('profiles').upsert({
      id: user.id,
      email: user.email,
      // display_name removed
      discord_handle: discord,
      gamertag: gamertag,
      avatar: selectedAvatar,
      avatar_color: avatarColor,
      banner_color: bannerColor,
      platform: platform,
    });
    if (error) { alert(error.message || 'Failed to save profile.'); return; }
    // Also update team avatar/banner in Supabase if user is captain
    if (supabaseClient) {
      const team = getUserTeam();
      if (team) {
        await supabaseClient.from('teams').update({
          avatar: selectedAvatar,
          banner_color: bannerColor,
        }).eq('id', team.id);
      }
    }
    // Update localStorage
    const users = loadUsers();
    const idx = users.findIndex(u => u.email === user.email.toLowerCase());
    if (idx !== -1) {
      // displayName removed
      users[idx].discord = discord;
      users[idx].gamertag = gamertag;
      saveUsers(users);
    }
    alert('Profile saved!');
    // Redirect to team page if they have a team
    const myTeam = getUserTeam();
    if (myTeam) {
      window.location.href = 'team.html?id=' + myTeam.id;
    } else {
      window.location.href = 'tournaments.html';
    }
  } catch(err) { console.error('Error saving profile:', err); alert('Failed to save profile.'); }
}

function updateBannerPreview(color) {
  const preview = document.getElementById('banner-preview');
  if (preview) preview.style.background = `linear-gradient(135deg, ${color} 0%, #0a0a0a 100%)`;
}

function buildProfileEditor() {
  const main = document.querySelector('main.container.profile-page');
  if (!main) return;
  main.innerHTML = '';

  // Top row: heading + View Team Page button
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.5rem;';
  const heading = document.createElement('h1');
  heading.textContent = 'Team Profile';
  heading.style.margin = '0';
  topRow.appendChild(heading);

  const viewTeamBtn = document.createElement('a');
  viewTeamBtn.className = 'button';
  viewTeamBtn.style.cssText = 'font-size:0.85rem;padding:0.5rem 1rem;text-decoration:none;';
  viewTeamBtn.textContent = '👁 View Team Page';
  viewTeamBtn.href = '#'; // updated after team loads
  viewTeamBtn.id = 'view-team-page-btn';
  topRow.appendChild(viewTeamBtn);
  main.appendChild(topRow);

  const sub = document.createElement('p');
  sub.style.color = 'var(--text-muted)';
  sub.style.marginBottom = '1.5rem';
  sub.textContent = 'Your profile is your team page. Set up your avatar, banner, and gamertag.';
  main.appendChild(sub);

  // Banner preview
  const preview = document.createElement('div');
  preview.id = 'banner-preview';
  preview.className = 'banner-preview';
  preview.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #0a0a0a 100%)';
  const previewAvatar = document.createElement('div');
  previewAvatar.id = 'preview-avatar';
  previewAvatar.innerHTML = renderAvatarSVG('wolf', 64);
  preview.appendChild(previewAvatar);
  main.appendChild(preview);

  const form = document.createElement('form');
  form.id = 'profile-form';
  form.className = 'auth-form profile-editor-form';

  // Basic info section
  const infoSection = document.createElement('div');
  infoSection.className = 'profile-section';
  infoSection.innerHTML = '<h3 class="profile-section-title">Basic Info</h3>';

  ['Discord Handle:discord:Discord#1234', 'Gamertag:gamertag:Your Gamertag'].forEach(field => {
    const [label, id, placeholder] = field.split(':');
    const lbl = document.createElement('label');
    lbl.innerHTML = `${label}<input type="text" id="profile-${id}" placeholder="${placeholder}" required />`;
    infoSection.appendChild(lbl);
  });
  form.appendChild(infoSection);

  // Platform
  const platformSection = document.createElement('div');
  platformSection.className = 'profile-section';
  platformSection.innerHTML = '<h3 class="profile-section-title">Platform</h3>';
  const platformRow = document.createElement('div');
  platformRow.className = 'platform-row';
  ['ps5', 'xbox'].forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'platform-btn' + (p === 'ps5' ? ' active' : '');
    btn.dataset.platform = p;
    btn.textContent = p === 'ps5' ? '🎮 PS5' : '🎮 Xbox';
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    platformRow.appendChild(btn);
  });
  platformSection.appendChild(platformRow);
  form.appendChild(platformSection);

  // Banner color
  const bannerSection = document.createElement('div');
  bannerSection.className = 'profile-section';
  bannerSection.innerHTML = '<h3 class="profile-section-title">Banner Color</h3>';
  const colorRow = document.createElement('div');
  colorRow.className = 'color-row';
  const BANNER_COLORS = ['#1a1a2e','#0d1b2a','#1a0a2e','#0a1a0a','#2e0a0a','#0a1e2e','#1e1a0a','#0a0a0a','#1a1a1a','#2e1a0a','#0a2e1a','#2e2e0a','#0a0a2e','#2e0a2e','#1a2e2e','#2e1a1a','#0d0d1e','#1e0d0d','#0d1e0d','#1e1e0a'];
  BANNER_COLORS.forEach(color => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      document.getElementById('profile-banner-color').value = color;
      updateBannerPreview(color);
      const previewAv = document.getElementById('preview-avatar');
      if (previewAv) {
        const sel = document.querySelector('.avatar-option.selected');
        if (sel) previewAv.innerHTML = renderAvatarSVG(sel.dataset.avatar, 64);
      }
    });
    colorRow.appendChild(swatch);
  });
  // Also a hidden color input for the actual value
  const colorInput = document.createElement('input');
  colorInput.type = 'hidden';
  colorInput.id = 'profile-banner-color';
  colorInput.value = '#1a1a2e';
  colorRow.appendChild(colorInput);
  bannerSection.appendChild(colorRow);
  form.appendChild(bannerSection);

  // Avatar color picker
  const avatarColorSection = document.createElement('div');
  avatarColorSection.className = 'profile-section';
  avatarColorSection.innerHTML = '<h3 class="profile-section-title">Avatar Color</h3>';
  const avatarColorRow = document.createElement('div');
  avatarColorRow.className = 'color-row';
  const AVATAR_COLOR_OPTIONS = ['#1a1a2e','#0d2b1a','#2b0d0d','#1a0d2b','#2b1a0d','#0d1a2b','#1a2b0d','#2b2b0d','#0d2b2b','#1c1c1c','#3b1a00','#00213b','#1f003b','#003b1f','#3b003b','#3b3b00','#003b3b','#2e0e0e','#0e2e0e','#0e0e2e'];
  AVATAR_COLOR_OPTIONS.forEach((color, i) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch avatar-color-swatch' + (i === 0 ? ' active' : '');
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.avatar-color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      document.getElementById('profile-avatar-color').value = color;
      // Update preview
      const sel = document.querySelector('.avatar-option.selected');
      const previewAv = document.getElementById('preview-avatar');
      if (previewAv && sel) previewAv.innerHTML = renderAvatarSVG(sel.dataset.avatar, 64, color);
    });
    avatarColorRow.appendChild(swatch);
  });
  const avatarColorInput = document.createElement('input');
  avatarColorInput.type = 'hidden';
  avatarColorInput.id = 'profile-avatar-color';
  avatarColorInput.value = '#1a1a2e';
  avatarColorRow.appendChild(avatarColorInput);
  avatarColorSection.appendChild(avatarColorRow);
  form.appendChild(avatarColorSection);

  // Avatar picker
  const avatarSection = document.createElement('div');
  avatarSection.className = 'profile-section';
  avatarSection.innerHTML = '<h3 class="profile-section-title">Avatar</h3>';
  const avatarGrid = document.createElement('div');
  avatarGrid.className = 'avatar-picker-grid';
  AVATARS.forEach((av, i) => {
    const opt = document.createElement('div');
    opt.className = 'avatar-option' + (i === 0 ? ' selected' : '');
    opt.dataset.avatar = av.id;
    opt.title = av.label;
    const avColor = document.getElementById('profile-avatar-color')?.value || '#1a1a2e';
    opt.innerHTML = renderAvatarSVG(av.id, 44, avColor);
    opt.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const currentColor = document.getElementById('profile-avatar-color')?.value || '#1a1a2e';
      const previewAv = document.getElementById('preview-avatar');
      if (previewAv) previewAv.innerHTML = renderAvatarSVG(av.id, 64, currentColor);
      // Refresh all option backgrounds to current color
      document.querySelectorAll('.avatar-option').forEach(o => {
        const c = document.getElementById('profile-avatar-color')?.value || '#1a1a2e';
        o.innerHTML = renderAvatarSVG(o.dataset.avatar, 44, c);
      });
    });
    avatarGrid.appendChild(opt);
  });
  avatarSection.appendChild(avatarGrid);
  form.appendChild(avatarSection);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'button';
  submitBtn.textContent = 'Save Profile';
  form.appendChild(submitBtn);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    await handleProfileSave();
  });

  main.appendChild(form);
}

// ── TEAM SEARCH ──────────────────────────────────────────────────────────────
function renderTeamSearch() {
  const container = document.getElementById('team-search-container');
  if (!container) return;

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'team-search-wrap';

  const searchRow = document.createElement('div');
  searchRow.className = 'team-search-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'team-search-input';
  input.placeholder = 'Search teams by name or gamertag...';

  const resultsEl = document.createElement('div');
  resultsEl.className = 'team-search-results';

  async function doSearch(q) {
    resultsEl.innerHTML = '';
    if (!q || q.length < 2) return;
    q = q.toLowerCase();
    await syncTeamsFromBackend();
    const teams = loadTeams();

    // Build gamertag map from profiles if supabase available
    let gamertagMap = {};
    if (supabaseClient) {
      try {
        const { data } = await supabaseClient.from('profiles').select('email, gamertag, avatar, avatar_color');
        if (data) data.forEach(p => { gamertagMap[p.email] = { gamertag: p.gamertag, avatar: p.avatar, avatar_color: p.avatar_color }; });
      } catch(e) {}
    }

    const matched = teams.filter(t => {
      if (t.name.toLowerCase().includes(q)) return true;
      const cap = gamertagMap[t.captain];
      if (cap && cap.gamertag && cap.gamertag.toLowerCase().includes(q)) return true;
      return false;
    });

    if (matched.length === 0) {
      resultsEl.innerHTML = '<p style="color:var(--text-muted);padding:0.5rem">No teams found.</p>';
      return;
    }

    matched.slice(0, 8).forEach(t => {
      const capData = gamertagMap[t.captain] || {};
      const avatarId = capData.avatar || t.avatar || 'wolf';
      const avColor = capData.avatar_color || '#1a1a2e';
      const row = document.createElement('a');
      row.href = 'team.html?id=' + t.id;
      row.className = 'team-search-result-row';
      row.innerHTML = `
        <span class="tsr-avatar">${renderAvatarSVG(avatarId, 32, avColor)}</span>
        <span class="tsr-name">${t.name}</span>
        <span class="tsr-captain">${capData.gamertag || t.captain}</span>
      `;
      resultsEl.appendChild(row);
    });
  }

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => doSearch(input.value.trim()), 300);
  });

  searchRow.appendChild(input);
  wrap.appendChild(searchRow);
  wrap.appendChild(resultsEl);
  container.appendChild(wrap);
}

// ── SCORE SUBMISSION (Phase 2) ────────────────────────────────────────────────
async function submitScoreRequest(tournamentId, roundIndex, matchIndex, reportedWinner, screenshotFile) {
  if (!supabaseClient) return false;
  const email = getCurrentUser();
  if (!email) return false;

  let screenshotUrl = null;
  if (screenshotFile) {
    try {
      const ext = screenshotFile.name.split('.').pop().toLowerCase();
      const safeName = Date.now() + '_' + Math.random().toString(36).slice(2,7);
      const path = `scores/${safeName}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('score-screenshots')
        .upload(path, screenshotFile, { upsert: true, contentType: screenshotFile.type });
      if (uploadError) {
        console.error('Screenshot storage upload error:', uploadError);
        const bucketMsg = uploadError.message || JSON.stringify(uploadError);
        // If it's a bucket/permissions issue, warn but continue — save record with null URL
        if (uploadError.statusCode === 404 || uploadError.message?.includes('bucket') || uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket')) {
          alert('⚠️ Screenshot storage not configured — your result will still be submitted but without the image.\n\nAdmin: create the \'score-screenshots\' bucket in Supabase Storage.');
          screenshotUrl = null; // continue without screenshot
        } else {
          alert('Screenshot upload failed: ' + bucketMsg);
          return false;
        }
      }
      if (uploadData) {
        const { data: urlData } = supabaseClient.storage.from('score-screenshots').getPublicUrl(path);
        screenshotUrl = urlData?.publicUrl || null;
        console.log('Screenshot uploaded:', screenshotUrl);
      }
    } catch(e) {
      console.error('Screenshot upload exception:', e);
      alert('Screenshot upload failed: ' + e.message);
      return false;
    }
  }

  try {
    // Safely get auth user — don't destructure in case data is null
    let submitterEmail = email || 'unknown';
    try {
      const authResp = await supabaseClient.auth.getUser();
      if (authResp?.data?.user?.email) {
        submitterEmail = authResp.data.user.email;
      }
    } catch(authErr) {
      console.warn('Could not get auth user, using localStorage email:', authErr);
    }

    console.log('Inserting score submission:', {
      tournament_id: tournamentId,
      round_index: roundIndex,
      match_index: matchIndex,
      submitter_email: submitterEmail,
      reported_winner: reportedWinner,
      screenshot_url: screenshotUrl,
    });

    const { error } = await supabaseClient.from('score_submissions').insert({
      tournament_id: String(tournamentId),
      round_index: parseInt(roundIndex),
      match_index: parseInt(matchIndex),
      submitter_email: submitterEmail,
      reported_winner: reportedWinner,
      screenshot_url: screenshotUrl,
      status: 'pending',
    });
    if (error) {
      console.error('Score submission DB error:', JSON.stringify(error));
      const msg = error.message || error.details || JSON.stringify(error);
      alert('❌ Submission failed: ' + msg + '\n\nIf this says "violates not-null constraint", run the SQL fix in Supabase. If it says "RLS" or "permission", disable Row Level Security on score_submissions.');
      return false;
    }
    console.log('Score submission inserted OK');
    // Alert mods via Discord webhook — fire and forget, do NOT let failures block return
    (async function() {
      try {
        const subWhUrl = localStorage.getItem('webhook_submissions');
        console.log('[Webhook] Score submission firing. URL saved?', !!subWhUrl, '| Winner:', reportedWinner);
        let tName = String(tournamentId);
        const localTournaments = loadTournaments();
        const localT = localTournaments.find(function(x) { return String(x.id) === String(tournamentId); });
        if (localT && localT.name) {
          tName = localT.name;
        } else if (supabaseClient) {
          const { data: tRow } = await supabaseClient.from('tournaments').select('name').eq('id', String(tournamentId)).single();
          if (tRow && tRow.name) tName = tRow.name;
        }
        console.log('[Webhook] Score submission params — tournament:', tName, 'winner:', reportedWinner, 'submitter:', submitterEmail);
        await announceScoreSubmission(tName, reportedWinner, submitterEmail);
        console.log('[Webhook] Score submission webhook fired OK');
      } catch(whErr) {
        console.warn('[Webhook] Score submission webhook error (non-blocking):', whErr);
      }
    })();
    return true;
  } catch(e) {
    console.error('Score submission exception:', e);
    alert('Submission error: ' + e.message);
    return false;
  }
}

function renderScoreSubmitForm(tournamentId, roundIndex, matchIndex, match, containerEl) {
  const form = document.createElement('div');
  form.className = 'score-submit-form';

  const title = document.createElement('p');
  title.className = 'score-submit-title';
  title.textContent = '📸 Submit Score';
  form.appendChild(title);

  const scoreRow = document.createElement('div');
  scoreRow.className = 'score-row';

  // Winner picker
  const winnerLabel = document.createElement('p');
  winnerLabel.textContent = 'Who won?';
  winnerLabel.style.cssText = 'font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem;';
  form.appendChild(winnerLabel);

  const winnerSelect = document.createElement('select');
  winnerSelect.className = 'score-input';
  winnerSelect.style.cssText = 'width:100%;padding:0.5rem 0.75rem;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font-body);font-size:0.9rem;cursor:pointer;';
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = '— Select winner —'; placeholder.disabled = true; placeholder.selected = true;
  winnerSelect.appendChild(placeholder);
  [match.team1, match.team2].filter(Boolean).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    winnerSelect.appendChild(opt);
  });
  form.appendChild(winnerSelect);

  // Screenshot upload
  const fileLabel = document.createElement('label');
  fileLabel.className = 'score-file-label';
  fileLabel.style.marginTop = '0.75rem';
  fileLabel.innerHTML = '📸 Attach final score screenshot <span style="color:var(--text-muted);font-size:0.75rem">(required)</span>';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileLabel.appendChild(fileInput);
  fileInput.addEventListener('change', () => {
    const name = fileInput.files[0]?.name || '';
    fileLabel.innerHTML = name ? ('✅ ' + name) : '📸 Attach final score screenshot <span style="color:var(--text-muted);font-size:0.75rem">(required)</span>';
  });
  form.appendChild(fileLabel);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'button score-submit-btn';
  submitBtn.textContent = 'Submit Result';
  submitBtn.addEventListener('click', async () => {
    const winner = winnerSelect.value;
    if (!winner) { alert('Please select who won.'); return; }
    if (!fileInput.files[0]) { alert('Please attach a screenshot of the final score.'); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    const ok = await submitScoreRequest(tournamentId, roundIndex, matchIndex, winner, fileInput.files[0]);
    if (ok) {
      form.innerHTML = '<p style="color:var(--gold);font-size:0.9rem">✅ Result submitted — waiting for admin confirmation.</p>';
    } else {
      // Error alert already shown inside submitScoreRequest
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Result';
    }
  });
  form.appendChild(submitBtn);
  containerEl.appendChild(form);
}

// Admin: render pending score submissions
async function renderPendingScores() {
  const container = document.getElementById('admin-scores-container');
  if (!container || !supabaseClient) return;
  container.innerHTML = '<p style="color:var(--text-muted)">Loading...</p>';

  try {
    const { data, error } = await supabaseClient
      .from('score_submissions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Score submissions fetch error:', JSON.stringify(error));
      container.innerHTML = `<p style="color:#ff6b6b;">⚠️ Error loading submissions: ${error.message || JSON.stringify(error)}<br><small>Check Supabase RLS settings — score_submissions table must have RLS disabled or allow admin reads.</small></p>`;
      return;
    }
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted)">No pending score submissions.</p>';
      return;
    }

    console.log('Score queue: fetched', data.length, 'pending submissions:', data.map(s => s.id));
    container.innerHTML = '';

    // Fetch all relevant tournaments from Supabase so bracket data is fresh
    let supabaseTourns = [];
    try {
      const tIds = [...new Set(data.map(s => s.tournament_id))];
      const { data: tData } = await supabaseClient
        .from('tournaments')
        .select('id, name, bracket')
        .in('id', tIds);
      if (tData) supabaseTourns = tData;
    } catch(e) { console.warn('Could not fetch tournaments for score queue', e); }

    data.forEach(sub => {
      const card = document.createElement('div');
      card.className = 'score-sub-card';

      // Use fresh Supabase bracket data, fall back to localStorage
      let matchTourney = supabaseTourns.find(t => String(t.id) === String(sub.tournament_id));
      if (!matchTourney) {
        const localTourns = loadTournaments();
        matchTourney = localTourns.find(t => String(t.id) === String(sub.tournament_id));
      }

      // Bracket may come back as object from jsonb — normalize it
      let bracket = matchTourney?.bracket || [];
      if (!Array.isArray(bracket)) bracket = Object.values(bracket);
      const bracketMatch = bracket?.[sub.round_index]?.[sub.match_index];
      const team1 = bracketMatch?.team1 || 'Team 1';
      const team2 = bracketMatch?.team2 || 'Team 2';

      card.innerHTML = `
        <div class="score-card-header">
          <span class="score-card-badge">Round ${sub.round_index + 1} · Match ${sub.match_index + 1}</span>
          <span class="score-card-tourney">${matchTourney?.name || sub.tournament_id}</span>
        </div>
        <div class="score-matchup">${team1} <span class="vs-divider">vs</span> ${team2}</div>
        <p class="score-card-meta">Reported winner: <strong style="color:var(--gold)">${sub.reported_winner || '—'}</strong></p>
        <p class="score-card-meta">Submitted by: ${sub.submitter_email}</p>
        ${sub.screenshot_url ? `
          <div class="score-screenshot-wrap" onclick="window.open('${sub.screenshot_url}','_blank')" style="cursor:pointer;">
            <img src="${sub.screenshot_url}" alt="Score screenshot" class="score-screenshot-img"
              crossorigin="anonymous"
              onerror="this.style.display='none';this.nextElementSibling.style.display='block';" />
            <p style="display:none;color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">⚠️ Image failed to load — <a href="${sub.screenshot_url}" target="_blank" style="color:var(--gold)">open directly</a></p>
            <span class="score-screenshot-hint">Click to open full size</span>
          </div>
        ` : '<p class="score-card-meta" style="color:var(--text-muted)">⚠️ No screenshot provided</p>'}
        <div class="score-admin-entry">
          <p style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.5rem;">Enter final scores to confirm</p>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <input id="score-t1-${sub.id}" type="number" min="0" max="99" placeholder="${team1} goals" class="score-input score-admin-input" />
            <span style="color:var(--text-muted);font-weight:700;">–</span>
            <input id="score-t2-${sub.id}" type="number" min="0" max="99" placeholder="${team2} goals" class="score-input score-admin-input" />
          </div>
        </div>
      `;

      const btnRow = document.createElement('div');
      btnRow.className = 'score-sub-btn-row';

      const approveBtn = document.createElement('button');
      approveBtn.className = 'button';
      approveBtn.textContent = '✅ Approve';
      approveBtn.addEventListener('click', async () => {
        const t1Score = parseInt(document.getElementById(`score-t1-${sub.id}`)?.value);
        const t2Score = parseInt(document.getElementById(`score-t2-${sub.id}`)?.value);
        if (isNaN(t1Score) || isNaN(t2Score)) { alert('Please enter both final scores before approving.'); return; }
        await approveScoreSubmission(sub, team1, team2, t1Score, t2Score);
        renderPendingScores();
      });

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'button delete';
      rejectBtn.textContent = '❌ Reject';
      rejectBtn.addEventListener('click', async () => {
        await supabaseClient.from('score_submissions').update({ status: 'rejected' }).eq('id', sub.id);
        renderPendingScores();
      });

      btnRow.appendChild(approveBtn);
      btnRow.appendChild(rejectBtn);
      card.appendChild(btnRow);
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = '<p style="color:var(--text-muted)">Failed to load submissions.</p>';
  }
}

async function approveScoreSubmission(sub, team1, team2, t1Score, t2Score) {
  if (!supabaseClient) return;

  // Admin determines the winner from the scores they entered
  const winnerName = t1Score > t2Score ? team1 : team2;

  // Store the admin-confirmed scores on the submission
  await supabaseClient.from('score_submissions').update({
    status: 'approved',
    admin_score_t1: t1Score,
    admin_score_t2: t2Score,
    admin_winner: winnerName,
  }).eq('id', sub.id);

  // Report the match result which advances the bracket
  await reportMatchResult(sub.tournament_id, sub.round_index, sub.match_index, winnerName, t1Score, t2Score);
}


// ── PHASE 4: MATCH HISTORY (Supabase persistence) ────────────────────────────

async function saveMatchToHistory(tournamentId, tournamentName, roundIndex, match, winnerName) {
  if (!supabaseClient) return;
  try {
    await supabaseClient.from('match_history').insert({
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      round_index: roundIndex,
      team1: match.team1,
      team2: match.team2,
      winner: winnerName,
      match_code: match.code || null,
    });
  } catch(e) { console.warn('match_history insert failed', e); }
}

async function loadTeamMatchHistory(teamName) {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('match_history')
      .select('*')
      .or(`team1.eq.${teamName},team2.eq.${teamName}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return [];
    return data || [];
  } catch(e) { return []; }
}

// ── PHASE 5: TOURNAMENT PASSWORD ─────────────────────────────────────────────
// Password is stored as tournament.password in the bracket object
// When joining, user must enter matching password

function checkTournamentPassword(tournament, enteredPassword) {
  if (!tournament.password) return true; // no password set = open
  return tournament.password === enteredPassword;
}

// ── PHASE 6: DISCORD WEBHOOKS (Multi-channel) ───────────────────────────────
// Four separate webhook URLs, each posting to a different Discord channel:
//   webhook_results       → #score-results      (match winner + score, bracket)
//   webhook_champions     → #champions          (tournament champion)
//   webhook_submissions   → #score-submissions  (new photo submitted — alert mods)
//   webhook_registrations → #registrations      (new team joined a tournament)

// WEBHOOK_KEYS defined at top of file

function getWebhookUrl(type) {
  return localStorage.getItem(WEBHOOK_KEYS[type]) || null;
}

async function sendToWebhook(type, embeds, content) {
  const url = getWebhookUrl(type);
  if (!url) { console.warn('No webhook URL set for:', type); return; }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content || undefined, embeds: embeds || [] }),
    });
    if (!res.ok) console.error('Webhook [' + type + '] failed:', res.status);
    else console.log('Webhook [' + type + '] sent OK');
  } catch(e) { console.warn('Webhook [' + type + '] error:', e); }
}

// 1. Match result → #score-results
async function announceMatchResult(tournamentName, team1, team2, winner, score1, score2) {
  const loser = team1 === winner ? team2 : team1;
  const hasScores = score1 !== undefined && score2 !== undefined && !isNaN(score1) && !isNaN(score2);
  const scoreStr = hasScores ? '\n📊 **' + team1 + '** ' + score1 + ' – ' + score2 + ' **' + team2 + '**' : '';
  await sendToWebhook('results', [{
    title: '🏒 Match Result',
    description: '**' + winner + '** defeated **' + loser + '**' + scoreStr,
    color: 0xffc72c,
    fields: [{ name: 'Tournament', value: tournamentName, inline: true }],
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
}

// 2. Tournament champion → #champions
async function announceTournamentComplete(tournamentName, winner) {
  await sendToWebhook('champions', [{
    title: '🏆 ' + winner + ' are the Champions!',
    description: '**' + winner + '** are the champions of **' + tournamentName + '**!\n\nCongratulations! 🎉👑',
    color: 0xffd700,
    thumbnail: { url: 'https://www.reggysosa.com/logo.png' },
    footer: { text: 'Reggy Sosa Tournaments • ' + new Date().toLocaleDateString() },
    timestamp: new Date().toISOString(),
  }]);
}

// 3. Score photo submitted → #score-submissions (mod alert)
async function announceScoreSubmission(tournamentName, reportedWinner, submitterEmail) {
  await sendToWebhook('submissions', [{
    title: '📸 Score Submission — Review Needed',
    description: 'A player has submitted a match result and is waiting for admin approval.\n\nGo to **Admin → Score Queue** to review and enter the final score.',
    color: 0xff9500,
    fields: [
      { name: 'Tournament', value: tournamentName || 'Unknown', inline: true },
      { name: 'Reported Winner', value: reportedWinner || 'Not specified', inline: true },
      { name: 'Submitted by', value: submitterEmail || 'Unknown', inline: false },
    ],
    footer: { text: 'reggysosa.com/admin.html' },
    timestamp: new Date().toISOString(),
  }]);
}

// 4. Team registered → #registrations
async function announceTeamRegistration(teamName, tournamentName, totalTeams, maxTeams) {
  await sendToWebhook('registrations', [{
    title: '👥 New Team Registered',
    description: '**' + teamName + '** has entered the tournament!',
    color: 0x00c9a7,
    fields: [
      { name: 'Tournament', value: tournamentName, inline: true },
      { name: 'Spots Filled', value: totalTeams + ' / ' + (maxTeams || '∞'), inline: true },
    ],
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
}

// 5. Bracket generated → #score-results (match codes hidden)
async function announceBracketGenerated(tournamentName, bracket) {
  if (!bracket || !Array.isArray(bracket) || bracket.length === 0) return;
  const round1 = bracket[0] || [];
  const matchLines = round1
    .filter(function(m) { return m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE'; })
    .map(function(m) { return '⚔️  **' + m.team1 + '** vs **' + m.team2 + '**'; })
    .join('\n');
  await sendToWebhook('results', [{
    title: '🏒 Bracket Set — ' + tournamentName,
    description: 'The tournament has started! Here are the Round 1 matchups:\n\n' + (matchLines || 'No matchups yet') + '\n\nHead to **reggysosa.com** to find your match and get playing!',
    color: 0xffc72c,
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
}

// Load all 4 webhook inputs from localStorage
function loadWebhookSettings() {
  Object.entries(WEBHOOK_KEYS).forEach(function([type, key]) {
    const val = localStorage.getItem(key) || '';
    const input = document.getElementById('webhook-input-' + type);
    if (input) input.value = val;
  });
}

// Save all 4 webhook inputs to localStorage
function saveAllWebhooks() {
  Object.entries(WEBHOOK_KEYS).forEach(function([type, key]) {
    const input = document.getElementById('webhook-input-' + type);
    if (!input) { console.warn('[Webhook] No input found for:', type); return; }
    const url = input.value.trim();
    if (url) { localStorage.setItem(key, url); console.log('[Webhook] Saved', key, '→', url.substring(0,50) + '...'); }
    else { localStorage.removeItem(key); console.log('[Webhook] Cleared', key); }
  });
  const status = document.getElementById('webhook-status');
  if (status) {
    status.textContent = '✅ All webhooks saved!';
    status.style.display = 'block';
    setTimeout(function() { status.style.display = 'none'; }, 2500);
  }
}

// Test a single webhook by type
async function testWebhook(type) {
  const url = getWebhookUrl(type);
  if (!url) { alert('No URL saved for "' + type + '" webhook yet. Save it first.'); return; }
  await sendToWebhook(type, [{
    title: '✅ Test — ' + type,
    description: 'This **' + type + '** webhook is connected and working!',
    color: 0xffc72c,
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
  alert('Test sent to ' + type + ' channel! Check Discord.');
}

// Legacy compat: migrate old single URL to results key on load
(function() {
  const legacy = localStorage.getItem('discordWebhookUrl') || localStorage.getItem('discord_webhook_url');
  if (legacy && !localStorage.getItem(WEBHOOK_KEYS.results)) {
    localStorage.setItem(WEBHOOK_KEYS.results, legacy);
  }
})();

// ── Leaderboard ──────────────────────────────────────────────────────────────

async function buildLeaderboardData() {
  // Pull latest data from backend before computing
  if (supabaseClient) {
    await syncTournamentsFromBackend();
    await syncTeamsFromBackend();
  }

  const tournaments = loadTournaments();
  const teams = loadTeams();

  // Map: teamName -> stats
  const stats = {};

  function getOrCreate(name) {
    if (!stats[name]) {
      stats[name] = {
        name,
        championships: 0,
        wins: 0,
        losses: 0,
        tournamentsEntered: 0,
        tournamentIds: new Set(),
      };
    }
    return stats[name];
  }

  for (const t of tournaments) {
    if (!t.bracket || !Array.isArray(t.bracket)) continue;

    // Count tournament entries — any team in this tournament
    const enteredTeams = new Set();
    t.bracket.forEach(round => {
      round.forEach(match => {
        if (match.team1 && match.team1 !== 'BYE') enteredTeams.add(match.team1);
        if (match.team2 && match.team2 !== 'BYE') enteredTeams.add(match.team2);
      });
    });
    enteredTeams.forEach(name => {
      const s = getOrCreate(name);
      if (!s.tournamentIds.has(t.id)) {
        s.tournamentIds.add(t.id);
        s.tournamentsEntered++;
      }
    });

    // Count wins and losses from completed matches
    t.bracket.forEach(round => {
      round.forEach(match => {
        if (!match.winner || !match.team1 || !match.team2) return;
        if (match.team2 === 'BYE') return;
        const winner = match.winner;
        const loser = match.team1 === winner ? match.team2 : match.team1;
        getOrCreate(winner).wins++;
        getOrCreate(loser).losses++;
      });
    });

    // Championship
    if (t.status === 'completed' && t.winner) {
      getOrCreate(t.winner).championships++;
    }
  }

  // Convert to array and compute win %
  return Object.values(stats).map(s => ({
    ...s,
    tournamentIds: undefined,
    winPct: s.wins + s.losses > 0
      ? Math.round((s.wins / (s.wins + s.losses)) * 100)
      : 0,
  }));
}

async function renderLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Loading leaderboard...</p>';

  let data;
  try {
    data = await buildLeaderboardData();
  } catch (e) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Failed to load leaderboard.</p>';
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No tournament data yet. Check back after the first tournament completes!</p>';
    return;
  }

  // Current sort state
  let sortKey = 'championships';
  let sortDir = 'desc';

  function sorted(key, dir) {
    return [...data].sort((a, b) => {
      if (dir === 'desc') return b[key] - a[key];
      return a[key] - b[key];
    });
  }

  function render(key, dir) {
    container.innerHTML = '';

    // Header row with filter buttons
    const header = document.createElement('div');
    header.className = 'leaderboard-header';

    const title = document.createElement('h2');
    title.className = 'leaderboard-title';
    title.textContent = 'Team Leaderboard';
    header.appendChild(title);

    const filters = document.createElement('div');
    filters.className = 'leaderboard-filters';

    const filterDefs = [
      { label: 'Championships', key: 'championships' },
      { label: 'Most Wins', key: 'wins' },
      { label: 'Win %', key: 'winPct' },
      { label: 'Tournaments', key: 'tournamentsEntered' },
    ];

    filterDefs.forEach(f => {
      const btn = document.createElement('button');
      btn.textContent = f.label;
      btn.className = 'leaderboard-filter-btn' + (f.key === key ? ' active' : '');
      btn.addEventListener('click', () => {
        const newDir = f.key === key && dir === 'desc' ? 'asc' : 'desc';
        sortKey = f.key;
        sortDir = newDir;
        render(sortKey, sortDir);
      });
      filters.appendChild(btn);
    });

    header.appendChild(filters);
    container.appendChild(header);

    // Table
    const table = document.createElement('div');
    table.className = 'leaderboard-table';

    // Column headers
    const colHeader = document.createElement('div');
    colHeader.className = 'leaderboard-row leaderboard-col-header';
    colHeader.innerHTML =
      '<span class="lb-rank">#</span>' +
      '<span class="lb-team">Team</span>' +
      '<span class="lb-stat">🏆</span>' +
      '<span class="lb-stat">W</span>' +
      '<span class="lb-stat">L</span>' +
      '<span class="lb-stat">W%</span>' +
      '<span class="lb-stat">Played</span>';
    table.appendChild(colHeader);

    const rows = sorted(key, dir);
    rows.forEach((team, i) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row' + (i < 3 ? ' top-' + (i + 1) : '');

      const rankEl = document.createElement('span');
      rankEl.className = 'lb-rank';
      rankEl.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);

      const nameEl = document.createElement('span');
      nameEl.className = 'lb-team';
      nameEl.textContent = team.name;
      if (team.championships > 0) {
        const badge = document.createElement('span');
        badge.className = 'lb-champ-badge';
        badge.textContent = team.championships + '×';
        nameEl.appendChild(badge);
      }

      const champEl = document.createElement('span');
      champEl.className = 'lb-stat' + (key === 'championships' ? ' highlight' : '');
      champEl.textContent = team.championships;

      const winsEl = document.createElement('span');
      winsEl.className = 'lb-stat' + (key === 'wins' ? ' highlight' : '');
      winsEl.textContent = team.wins;

      const lossEl = document.createElement('span');
      lossEl.className = 'lb-stat';
      lossEl.textContent = team.losses;

      const pctEl = document.createElement('span');
      pctEl.className = 'lb-stat' + (key === 'winPct' ? ' highlight' : '');
      pctEl.textContent = team.winPct + '%';

      const playedEl = document.createElement('span');
      playedEl.className = 'lb-stat' + (key === 'tournamentsEntered' ? ' highlight' : '');
      playedEl.textContent = team.tournamentsEntered;

      row.appendChild(rankEl);
      row.appendChild(nameEl);
      row.appendChild(champEl);
      row.appendChild(winsEl);
      row.appendChild(lossEl);
      row.appendChild(pctEl);
      row.appendChild(playedEl);
      table.appendChild(row);
    });

    container.appendChild(table);
  }

  render(sortKey, sortDir);
}

// ── Match Messaging System ──────────────────────────────────────────────────

// Returns true if the current user is a captain in the given match
function isUserInMatch(match, tournament) {
  const email = getCurrentUser();
  if (!email) return false;
  // Check localStorage teams first (fast path)
  const teams = loadTeams();
  const team1local = teams.find(t => t.name === match.team1);
  const team2local = teams.find(t => t.name === match.team2);
  if ((team1local && team1local.captain === email) || (team2local && team2local.captain === email)) return true;
  // Also check if the user's own team name matches either slot (name-only fallback)
  const myTeam = getUserTeam();
  if (myTeam && (myTeam.name === match.team1 || myTeam.name === match.team2)) return true;
  return false;
}

// Send a message to Supabase messages table
async function sendMatchMessage(matchCode, tournamentId, content) {
  if (!supabaseClient || !content.trim()) return false;
  const email = getCurrentUser();
  if (!email) return false;
  try {
    const { error } = await supabaseClient.from('messages').insert({
      match_code: matchCode,
      tournament_id: tournamentId,
      sender_email: email,
      content: content.trim(),
    });
    if (error) { console.error('Send message error:', error); return false; }
    return true;
  } catch (e) {
    console.error('Send message error:', e);
    return false;
  }
}

// Load messages for a match from Supabase
async function loadMatchMessages(matchCode) {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select('*')
      .eq('match_code', matchCode)
      .order('created_at', { ascending: true });
    if (error) return [];
    return data || [];
  } catch (e) { return []; }
}

// Delete all messages for a match (called when match winner is set)
async function deleteMatchMessages(matchCode) {
  if (!supabaseClient) return;
  try {
    await supabaseClient.from('messages').delete().eq('match_code', matchCode);
  } catch (e) { console.error('Delete messages error:', e); }
}

// Active chat subscriptions — we keep track to unsubscribe when needed
const activeChatSubscriptions = {};

// Render the chat box for a match inside a given container element
async function renderMatchChat(matchCode, tournamentId, containerEl, isAdmin) {
  const email = getCurrentUser();
  if (!email) return;

  // Wrapper
  const chatWrapper = document.createElement('div');
  chatWrapper.className = 'match-chat';
  chatWrapper.id = 'chat-' + matchCode;

  const chatTitle = document.createElement('p');
  chatTitle.className = 'chat-title';
  chatTitle.textContent = isAdmin ? '💬 Match Chat (Admin View)' : '💬 Match Chat';
  chatWrapper.appendChild(chatTitle);

  // Messages area
  const messagesEl = document.createElement('div');
  messagesEl.className = 'chat-messages';
  chatWrapper.appendChild(messagesEl);

  // Render a single message bubble
  function renderMessage(msg) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + (msg.sender_email === email ? 'mine' : 'theirs');
    if (msg.id) bubble.dataset.msgId = msg.id;
    const sender = document.createElement('span');
    sender.className = 'chat-sender';
    // Show "Admin" label if the message came from the admin email
    sender.textContent = msg.sender_email === '93pacc93@gmail.com' ? '⚙️ Admin' : msg.sender_email;
    const text = document.createElement('p');
    text.textContent = msg.content;
    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.appendChild(sender);
    bubble.appendChild(text);
    bubble.appendChild(time);
    return bubble;
  }

  // Load initial messages
  const initial = await loadMatchMessages(matchCode);
  initial.forEach(msg => messagesEl.appendChild(renderMessage(msg)));
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Real-time subscription
  if (activeChatSubscriptions[matchCode]) {
    try { activeChatSubscriptions[matchCode].unsubscribe(); } catch(e) {}
  }
  const channel = supabaseClient
    .channel('match-chat-' + matchCode)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: 'match_code=eq.' + matchCode,
    }, (payload) => {
      const newBubble = renderMessage(payload.new);
      messagesEl.appendChild(newBubble);
      if (isAdmin && payload.new?.id) addDeleteBtn(newBubble, payload.new.id, messagesEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    })
    .subscribe();
  activeChatSubscriptions[matchCode] = channel;

  // Input area — both players and admin can send; admin also gets delete buttons
  const inputRow = document.createElement('div');
  inputRow.className = 'chat-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-input';
  input.placeholder = isAdmin ? 'Send admin message...' : 'Type a message...';
  input.maxLength = 300;
  const sendBtn = document.createElement('button');
  sendBtn.className = 'button chat-send-btn';
  sendBtn.textContent = 'Send';

  async function doSend() {
    const val = input.value.trim();
    if (!val) return;
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    await sendMatchMessage(matchCode, tournamentId, val);
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  chatWrapper.appendChild(inputRow);

  if (isAdmin) {
    const adminNote = document.createElement('p');
    adminNote.className = 'chat-readonly-note';
    adminNote.textContent = '⚙️ Admin — you can message and delete individual messages';
    chatWrapper.appendChild(adminNote);

    // Add delete button to each existing bubble
    chatWrapper.querySelectorAll('.chat-bubble').forEach(bubble => {
      const msgId = bubble.dataset.msgId;
      if (msgId) addDeleteBtn(bubble, msgId, messagesEl);
    });
  }

  // Helper: add a delete button to a bubble (admin only)
  function addDeleteBtn(bubble, msgId, container) {
    if (!isAdmin || !msgId) return;
    const del = document.createElement('button');
    del.className = 'chat-delete-btn';
    del.title = 'Delete message';
    del.textContent = '🗑';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this message?')) return;
      const { error } = await supabaseClient.from('messages').delete().eq('id', msgId);
      if (!error) bubble.remove();
      else alert('Delete failed: ' + error.message);
    });
    bubble.appendChild(del);
  }

  containerEl.appendChild(chatWrapper);
}

// ── Admin: view all active match chats ──────────────────────────────────────
async function renderAdminChats() {
  const container = document.getElementById('admin-chats-container');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted)">Loading active match chats...</p>';

  if (!supabaseClient) {
    container.innerHTML = '<p>Supabase not connected.</p>';
    return;
  }

  // Get all messages grouped by match_code
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true });
    if (error || !data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted)">No active match chats.</p>';
      return;
    }
    // Group by match_code
    const grouped = {};
    data.forEach(msg => {
      if (!grouped[msg.match_code]) grouped[msg.match_code] = [];
      grouped[msg.match_code].push(msg);
    });
    container.innerHTML = '';
    Object.entries(grouped).forEach(([matchCode, messages]) => {
      const block = document.createElement('div');
      block.className = 'admin-chat-block';

      // Header row with match code + clear chat button
      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;';
      const heading = document.createElement('h4');
      heading.textContent = 'Match ' + matchCode;
      heading.style.cssText = 'color:var(--gold);margin:0;';
      const clearBtn = document.createElement('button');
      clearBtn.className = 'button delete';
      clearBtn.style.cssText = 'font-size:0.75rem;padding:0.3rem 0.75rem;';
      clearBtn.textContent = '🗑 Clear Chat';
      clearBtn.addEventListener('click', async () => {
        if (!confirm('Delete ALL messages in match ' + matchCode + '?')) return;
        const { error } = await supabaseClient.from('messages').delete().eq('match_code', matchCode);
        if (!error) { block.remove(); }
        else alert('Delete failed: ' + error.message);
      });
      headerRow.appendChild(heading);
      headerRow.appendChild(clearBtn);
      block.appendChild(headerRow);

      // Messages list
      const msgList = document.createElement('div');
      msgList.className = 'admin-chat-messages';
      const tournId = messages[0]?.tournament_id || '';

      messages.forEach(msg => {
        const line = document.createElement('div');
        line.className = 'admin-chat-line';
        line.dataset.msgId = msg.id || '';
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const senderLabel = msg.sender_email === '93pacc93@gmail.com' ? '⚙️ Admin' : msg.sender_email;
        line.innerHTML = '<span class="chat-sender">' + senderLabel + '</span><span class="chat-time">' + time + '</span><p class="chat-line-text">' + msg.content + '</p>';
        // Delete single message
        const delBtn = document.createElement('button');
        delBtn.className = 'chat-delete-btn';
        delBtn.title = 'Delete message';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this message?')) return;
          const { error } = await supabaseClient.from('messages').delete().eq('id', msg.id);
          if (!error) line.remove();
          else alert('Delete failed: ' + error.message);
        });
        line.appendChild(delBtn);
        msgList.appendChild(line);
      });
      block.appendChild(msgList);

      // Admin send box for this chat
      const sendRow = document.createElement('div');
      sendRow.className = 'chat-input-row';
      sendRow.style.marginTop = '0.75rem';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'chat-input';
      input.placeholder = 'Admin message to match ' + matchCode + '...';
      input.maxLength = 300;
      const sendBtn = document.createElement('button');
      sendBtn.className = 'button chat-send-btn';
      sendBtn.textContent = 'Send';
      async function doAdminSend() {
        const val = input.value.trim();
        if (!val) return;
        input.value = '';
        input.disabled = true; sendBtn.disabled = true;
        await sendMatchMessage(matchCode, tournId, val);
        // Refresh the tab to show new message
        setTimeout(() => renderAdminChats(), 500);
        input.disabled = false; sendBtn.disabled = false;
      }
      sendBtn.addEventListener('click', doAdminSend);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdminSend(); });
      sendRow.appendChild(input);
      sendRow.appendChild(sendBtn);
      block.appendChild(sendRow);

      container.appendChild(block);
    });
  } catch (e) {
    container.innerHTML = '<p style="color:var(--text-muted)">Failed to load chats.</p>';
  }
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

  // If the tournament has started but no bracket is present (for this user),
  // generate the bracket deterministically using the tournament id. This
  // ensures users who did not start the tournament still see the same
  // bracket and match codes. Save back to local storage so it persists.
  // Only regenerate bracket if tournament is started (not completed) AND bracket is truly missing
  if (
    (tournament.status === 'started') &&
    (!tournament.bracket || !Array.isArray(tournament.bracket) || tournament.bracket.length === 0) &&
    Array.isArray(tournament.teams) &&
    tournament.teams.length >= 2
  ) {
    let teamNames = tournament.teams.map((team) =>
      typeof team === 'string' ? team : team.name
    );
    // Sort team names to ensure deterministic bracket across devices
    teamNames = teamNames.slice().sort((a, b) => a.localeCompare(b));
    tournament.bracket = generateBracket(teamNames, tournament.id);
    // Save back to local storage AND backend
    const idx = tournaments.findIndex((t) => t.id === id);
    if (idx !== -1) {
      tournaments[idx] = tournament;
      saveTournaments(tournaments);
    }
    fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournament.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bracket: tournament.bracket, status: tournament.status }),
    }).catch(() => {});
  }
  container.innerHTML = '';
  const detail = document.createElement('div');
  detail.className = 'tournament-detail';

  // Top row: tournament name + admin Score Queue shortcut
  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.25rem;';
  const title = document.createElement('h2');
  title.textContent = tournament.name;
  title.style.margin = '0';
  titleRow.appendChild(title);
  // Admin shortcut button — only when tournament is running
  if (role === 'admin' && tournament.status === 'started') {
    const sqBtn = document.createElement('button');
    sqBtn.className = 'button';
    sqBtn.style.cssText = 'font-size:0.8rem;padding:0.4rem 0.9rem;display:flex;align-items:center;gap:0.4rem;';
    sqBtn.innerHTML = '📋 Score Queue';
    sqBtn.addEventListener('click', () => {
      // Navigate to admin page and open the Score Queue tab
      window.location.href = 'admin.html#scores';
    });
    titleRow.appendChild(sqBtn);
  }
  detail.appendChild(titleRow);

  const status = document.createElement('p');
  status.textContent = 'Status: ' + tournament.status;
  const created = document.createElement('p');
  const date = new Date(tournament.created);
  created.textContent = 'Created: ' + date.toLocaleString();
  detail.appendChild(status);
  detail.appendChild(created);
  // Display start date if defined
  if (tournament.startDate) {
    // Parse start date as local date for correct display
    const sd = new Date(tournament.startDate + 'T00:00:00');
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
      let idVal;
      if (typeof team === 'string') {
        name = team;
        idVal = null;
      } else {
        name = team.name;
        idVal = team.id;
      }
      /*
       * We only display team names in the list to protect user privacy.  
       * Admins can still remove teams, but we avoid showing email or Discord
       * information here.  When the admin dashboard needs detailed
       * information, it fetches directly from Supabase.
       */
      if (role === 'admin' && tournament.status !== 'started') {
        // For admins, still display remove button but no captain info
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
        // Non-admin view: show only team name
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
        // Score submission — show for captains in this match (not admin, no winner yet)
        if (
          tournament.status === 'started' &&
          match.team1 && match.team2 &&
          match.team2 !== 'BYE' &&
          !match.winner
        ) {
          const currentRole = getCurrentUserRole();
          if (currentRole !== 'admin' && isUserInMatch(match, tournament)) {
            // Check if a submission already exists so we don't re-show form on refresh
            const scoreSlot = document.createElement('div');
            matchDiv.appendChild(scoreSlot);
            (async () => {
              let alreadySubmitted = false;
              if (supabaseClient) {
                try {
                  const { data: existingSubs } = await supabaseClient
                    .from('score_submissions')
                    .select('id, status')
                    .eq('tournament_id', String(tournament.id))
                    .eq('round_index', rIndex)
                    .eq('match_index', mIndex)
                    .in('status', ['pending', 'approved'])
                    .limit(1);
                  if (existingSubs && existingSubs.length > 0) {
                    alreadySubmitted = true;
                  }
                } catch(e) { /* ignore, show form as fallback */ }
              }
              if (alreadySubmitted) {
                scoreSlot.innerHTML = '<p style="color:var(--gold);font-size:0.85rem;margin-top:0.5rem;">✅ Result submitted — waiting for admin confirmation.</p>';
              } else {
                renderScoreSubmitForm(tournament.id, rIndex, mIndex, match, scoreSlot);
              }
            })();
          }
        }
        // Match chat — show for admin (read-only) and the two captains in this match
        if (
          tournament.status === 'started' &&
          match.team1 && match.team2 &&
          match.team2 !== 'BYE' &&
          !match.winner &&
          match.code
        ) {
          const userRole = getCurrentUserRole();
          const isAdmin = userRole === 'admin';
          const isInMatch = isUserInMatch(match, tournament);
          if (isAdmin || isInMatch) {
            // Render chat async into matchDiv
            renderMatchChat(match.code, tournament.id, matchDiv, isAdmin);
          }
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
function generateCode(rng) {
  // Generate a deterministic or random 5‑digit numeric code. If a RNG
  // function is provided, use it to draw digits; otherwise fall back
  // to Math.random().
  let code = '';
  for (let i = 0; i < 5; i++) {
    const rand = rng ? rng() : Math.random();
    code += Math.floor(rand * 10);
  }
  return code;
}

function generateBracket(teams, seed) {
  /*
   * Generate a knockout bracket for the provided teams. If the number of
   * teams is not a power of two we pad the first round with BYE slots
   * and propagate TBD placeholders into subsequent rounds. Each match
   * receives a 5‑digit code. If a seed is provided, the bracket
   * shuffling and code generation will be deterministic across devices.
   */
  // Create a seeded random generator if a seed is supplied
  const rng = seed !== undefined ? seededRng(hashSeed(seed)) : null;
  // Clone and shuffle the team list
  const shuffled = teams.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Use seeded RNG for deterministic shuffle if available
    const rand = rng ? rng() : Math.random();
    const j = Math.floor(rand * (i + 1));
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
      round.push({ team1, team2, code: generateCode(rng), winner: null });
    }
    rounds.push(round);
    // Prepare array for next round winners (unknown winners become null)
    currentTeams = new Array(round.length).fill(null);
  }
  return rounds;
}

/**
 * Render the next upcoming tournament onto the home page. This function
 * locates the tournament with the nearest future start date and displays
 * it in the "next-tournament-card" element. If no future tournament
 * exists, the entire section is hidden.
 */
function renderNextTournament() {
  const container = document.getElementById('next-tournament-block');
  const section = document.getElementById('next-tournament-section');
  if (!container || !section) return;
  const tournaments = loadTournaments();
  const now = new Date();
  // Filter for tournaments that have a future start date and are not completed
  const upcoming = tournaments.filter((t) => {
    if (!t.startDate) return false;
    // Parse start date as a local date (add time to prevent timezone shift)
    const sd = new Date(t.startDate + 'T00:00:00');
    return sd >= now && t.status !== 'completed';
  });
  if (upcoming.length === 0) {
    section.style.display = 'none';
    return;
  }
  // Sort by start date ascending. Use local parsing to avoid timezone shift.
  upcoming.sort(
    (a, b) =>
      new Date(a.startDate + 'T00:00:00') - new Date(b.startDate + 'T00:00:00')
  );
  const next = upcoming[0];
  section.style.display = 'block';
  // Clear existing content
  container.innerHTML = '';
  // Build card contents
  const title = document.createElement('h3');
  title.textContent = next.name;
  container.appendChild(title);
  if (next.startDate) {
    // Display the start date using local timezone by appending a time string
    const sd = new Date(next.startDate + 'T00:00:00');
    const dateEl = document.createElement('p');
    dateEl.textContent = 'Starts: ' + sd.toLocaleDateString();
    container.appendChild(dateEl);
  }
  // Show current vs max teams
  const currentCount = next.teams ? next.teams.length : 0;
  const maxCount = next.maxTeams ? next.maxTeams : null;
  const teamEl = document.createElement('p');
  teamEl.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
  container.appendChild(teamEl);
  // CTA link to view/register
  const link = document.createElement('a');
  link.href = 'tournament.html?id=' + encodeURIComponent(next.id);
  link.className = 'button';
  link.textContent = 'View / Register';
  container.appendChild(link);
}

/**
 * Load the Twitch live status and render the Twitch card on the home page.
 * This function queries the back‑end endpoint at /api/twitch/status to determine
 * whether the channel is live. If the channel is live, it embeds the Twitch
 * player inside a responsive container. Otherwise it displays an offline
 * message and a button linking to the channel on Twitch.
 */
async function loadTwitchStatus() {
  const card = document.getElementById('twitch-card');
  if (!card) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/twitch/status`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    // Clear existing content
    card.innerHTML = '';
    if (data && data.live) {
      const playerWrapper = document.createElement('div');
      playerWrapper.className = 'twitch-player';
      playerWrapper.innerHTML =
        '<iframe src="https://player.twitch.tv/?channel=reggysosa&parent=reggysosa.com&parent=www.reggysosa.com" frameborder="0" allowfullscreen="true" scrolling="no"></iframe>';
      card.appendChild(playerWrapper);
    } else {
      const msgEl = document.createElement('p');
      msgEl.textContent = 'ReggySosa is offline';
      card.appendChild(msgEl);
      const btnEl = document.createElement('a');
      btnEl.href = 'https://www.twitch.tv/reggysosa';
      btnEl.target = '_blank';
      btnEl.className = 'button';
      btnEl.textContent = 'Watch on Twitch';
      card.appendChild(btnEl);
    }
  } catch (err) {
    console.error('Failed to load Twitch status', err);
    card.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = 'ReggySosa is offline';
    card.appendChild(p);
    const a = document.createElement('a');
    a.href = 'https://www.twitch.tv/reggysosa';
    a.target = '_blank';
    a.className = 'button';
    a.textContent = 'Watch on Twitch';
    card.appendChild(a);
  }
}