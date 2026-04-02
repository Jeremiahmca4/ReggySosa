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

const DISCORD_INVITE = 'https://discord.gg/XkCWmNEz5z';

// ── PRIZE POOL HELPERS ────────────────────────────────────────────────────────

function getPrizePoolPct() {
  const saved = localStorage.getItem('prize_pool_pct');
  const pct = parseFloat(saved);
  return (!isNaN(pct) && pct >= 0 && pct <= 100) ? pct : 70; // default 70%
}

function savePrizePoolPct(pct) {
  localStorage.setItem('prize_pool_pct', pct);
  // Also push to Supabase so it persists across devices
  if (supabaseClient) {
    supabaseClient.from('profiles')
      .update({ prize_pool_pct: pct })
      .eq('email', ADMIN_EMAIL)
      .then(() => {})
      .catch(() => {});
  }
}

async function loadPrizePoolPct() {
  // Try to load from Supabase first (admin's profile)
  if (supabaseClient) {
    try {
      const { data } = await supabaseClient
        .from('profiles')
        .select('prize_pool_pct')
        .eq('email', ADMIN_EMAIL)
        .single();
      if (data && data.prize_pool_pct != null) {
        localStorage.setItem('prize_pool_pct', data.prize_pool_pct);
        return parseFloat(data.prize_pool_pct);
      }
    } catch(e) { /* fall back to localStorage */ }
  }
  return getPrizePoolPct();
}

function calcPrizePool(tournament) {
  const fee = parseFloat(tournament.entry_fee || tournament.entryFee) || 0;
  if (fee === 0) return 0;
  const teams = tournament.teams ? tournament.teams.length : 0;
  const pct = getPrizePoolPct();
  return Math.round(fee * teams * (pct / 100) * 100) / 100;
}

function formatPrizePool(tournament) {
  const pool = calcPrizePool(tournament);
  if (pool === 0) return null;
  return `$${pool.toFixed(2)}`;
}
// ── PRE-PAYMENT INFO MODAL ────────────────────────────────────────────────────
function openEntryInfoModal({ tournament, teamId, entryFee, onConfirm }) {
  document.getElementById('entry-info-modal')?.remove();

  const pct = getPrizePoolPct();
  const hostingPct = 100 - pct;
  const maxTeams = tournament.maxTeams || 8;
  const currentTeams = tournament.teams ? tournament.teams.length : 0;
  const stripeFee = Math.round((entryFee * 0.029 + 0.30) * 100) / 100;
  const netPerEntry = Math.round((entryFee - stripeFee) * 100) / 100;
  const currentPrizePool = Math.round(currentTeams * entryFee * (pct / 100) * 100) / 100;
  const maxPrizePool = Math.round(maxTeams * entryFee * (pct / 100) * 100) / 100;
  const maxHostingFee = Math.round(maxTeams * entryFee * (hostingPct / 100) * 100) / 100;

  const modal = document.createElement('div');
  modal.id = 'entry-info-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;';

  modal.innerHTML = `
    <div style="background:#1a1a2e;border:1px solid #d4a017;border-radius:12px;padding:2rem;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;position:relative;">
      <button id="entry-info-close" style="position:absolute;top:1rem;right:1rem;background:none;border:none;color:#aaa;font-size:1.5rem;cursor:pointer;line-height:1;">×</button>

      <div style="text-align:center;margin-bottom:1.5rem;">
        <span style="font-size:2rem;display:block;margin-bottom:0.5rem;">🏆</span>
        <h2 style="color:#d4a017;font-size:1.3rem;margin:0 0 0.25rem;font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.06em;">${tournament.name}</h2>
        <p style="color:#ccc;margin:0;font-size:0.9rem;">Tournament Entry — Read before paying</p>
      </div>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:1rem;margin-bottom:1rem;">
        <p style="color:#d4a017;font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.06em;font-size:0.85rem;margin:0 0 0.75rem;font-weight:700;">💳 Entry Fee Breakdown</p>
        <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;font-size:0.9rem;">
          <span style="color:#ccc;">Entry Fee</span>
          <span style="color:#fff;font-weight:600;">$${entryFee.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;font-size:0.9rem;gap:1rem;">
          <span style="color:#ccc;">Stripe Processing Fee <span style="font-size:0.75rem;color:#888;">(goes directly to Stripe — not us)</span></span>
          <span style="color:#ff6b6b;white-space:nowrap;">-$${stripeFee.toFixed(2)}</span>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:0.4rem;display:flex;justify-content:space-between;font-size:0.9rem;">
          <span style="color:#ccc;">Net per entry</span>
          <span style="color:#50c878;font-weight:700;">$${netPerEntry.toFixed(2)}</span>
        </div>
      </div>

      <div style="background:rgba(212,160,23,0.08);border:1px solid rgba(212,160,23,0.3);border-radius:8px;padding:1rem;margin-bottom:1rem;">
        <p style="color:#d4a017;font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.06em;font-size:0.85rem;margin:0 0 0.75rem;font-weight:700;">🏆 Prize Pool</p>
        <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;font-size:0.9rem;gap:1rem;">
          <span style="color:#ccc;">Winner receives <span style="font-size:0.75rem;color:#888;">(${pct}% of net entries)</span></span>
          <span style="color:#d4a017;font-weight:700;white-space:nowrap;">$${maxPrizePool.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;font-size:0.9rem;gap:1rem;">
          <span style="color:#ccc;">Hosting fee <span style="font-size:0.75rem;color:#888;">(${hostingPct}% — keeps the platform running)</span></span>
          <span style="color:#aaa;white-space:nowrap;">$${maxHostingFee.toFixed(2)}</span>
        </div>
        <div style="border-top:1px solid rgba(212,160,23,0.2);padding-top:0.4rem;font-size:0.8rem;color:#888;margin-top:0.25rem;">
          Based on ${maxTeams} teams max. Current prize pool: <strong style="color:#d4a017;">$${currentPrizePool.toFixed(2)}</strong> (${currentTeams}/${maxTeams} teams registered)
        </div>
      </div>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:1rem;margin-bottom:1.25rem;">
        <p style="color:#d4a017;font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.06em;font-size:0.85rem;margin:0 0 0.75rem;font-weight:700;">💸 How Payouts Work</p>
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;font-size:0.88rem;color:#ccc;"><span>🏆</span><span>Win the tournament</span></div>
          <div style="display:flex;align-items:center;gap:0.75rem;font-size:0.88rem;color:#ccc;"><span>📩</span><span>Admin DMs you on Discord within 24 hours</span></div>
          <div style="display:flex;align-items:center;gap:0.75rem;font-size:0.88rem;color:#ccc;"><span>💸</span><span>Receive your prize via Venmo, PayPal, or Cash App</span></div>
        </div>
      </div>

      <p style="color:#666;font-size:0.75rem;text-align:center;margin-bottom:1.25rem;">All payments processed securely by Stripe. Entry fees are non-refundable once paid.</p>

      <button id="entry-info-confirm" style="width:100%;background:linear-gradient(135deg,#d4a017,#f0c040);color:#1a1a2e;border:none;border-radius:8px;padding:0.85rem;font-size:1rem;font-weight:700;cursor:pointer;margin-bottom:0.5rem;font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.06em;">
        ✅ I Understand — Pay $${entryFee.toFixed(2)} & Register
      </button>
      <button id="entry-info-cancel" style="width:100%;background:transparent;color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:0.6rem;font-size:0.9rem;cursor:pointer;">
        Cancel
      </button>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  function closeInfoModal() {
    modal.remove();
    document.body.style.overflow = '';
  }

  document.getElementById('entry-info-close').addEventListener('click', closeInfoModal);
  document.getElementById('entry-info-cancel').addEventListener('click', closeInfoModal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeInfoModal(); });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { closeInfoModal(); document.removeEventListener('keydown', escHandler); }
  });
  document.getElementById('entry-info-confirm').addEventListener('click', function() {
    closeInfoModal();
    onConfirm();
  });
}

// Registers team directly (faster than waiting for webhook) then refreshes UI.
window.onStripePaymentSuccess = async function({ tournamentId, teamId }) {
  try {
    // Register directly in Supabase — don't rely on webhook timing
    if (supabaseClient) {
      try {
        const { data: existing } = await supabaseClient
          .from('tournament_registrations')
          .select('id')
          .eq('tournament_id', tournamentId)
          .eq('team_id', teamId)
          .maybeSingle();
        if (!existing) {
          await supabaseClient
            .from('tournament_registrations')
            .insert({ tournament_id: tournamentId, team_id: teamId, paid: true });
        }
      } catch(e) {
        console.error('Direct registration after payment failed:', e);
      }
    }
    if (typeof syncTournamentsFromBackend === 'function') {
      await syncTournamentsFromBackend().catch(() => {});
    }
    if (typeof syncTeamsFromBackend === 'function') {
      await syncTeamsFromBackend().catch(() => {});
    }
    // Fire Discord registration webhook for paid registration
    try {
      const tournaments = loadTournaments();
      const t = tournaments.find(x => String(x.id) === String(tournamentId));
      const teams = loadTeams();
      const team = teams.find(x => String(x.id) === String(teamId));
      if (t && team) {
        const _total = t.teams ? t.teams.length : 1;
        const _max = t.maxTeams || t.max_teams || null;
        const _fee = t.entry_fee || t.entryFee || 0;
        announceTeamRegistration(team.name, t.name, _total, _max, _fee);
      }
    } catch(e) { console.warn('[Webhook] Paid registration announce error:', e); }
    if (typeof renderTournamentDetails === 'function' && tournamentId) {
      renderTournamentDetails(String(tournamentId));
    }
  } catch(e) {
    console.error('onStripePaymentSuccess error:', e);
  }
};
// Discord webhook localStorage keys — declared here so all functions can access them
// regardless of call order (const inside a module block would cause TDZ errors)
var WEBHOOK_KEYS = {
  results:       'webhook_results',
  champions:     'webhook_champions',
  submissions:   'webhook_submissions',
  registrations: 'webhook_registrations',
  created:       'webhook_created',
  checkIn:       'webhook_checkin',
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
          startTime: row.start_time ?? row.startTime ?? null,
          status: row.status || 'open',
          created: row.created_at ?? row.created ?? new Date().toISOString(),
          bracket: Array.isArray(row.bracket) ? row.bracket : (row.bracket && typeof row.bracket === 'object' ? Object.values(row.bracket) : []),
          winner: row.winner || null,
          password: row.password || null,
          entry_fee: parseFloat(row.entry_fee) || 0,
          goalieRequired: row.goalie_required === true || row.goalie_required === 'true' || row.goalieRequired === true || false,
          startTime: row.start_time ?? row.startTime ?? null,
        };
        // If we have a Supabase client, fetch registered teams for this tournament.
        if (supabaseClient) {
          try {
            // Get all team IDs registered for this tournament
            const { data: regs, error: regsErr } = await supabaseClient
              .from('tournament_registrations')
              .select('team_id, waitlisted')
              .eq('tournament_id', row.id);
            if (!regsErr && Array.isArray(regs) && regs.length > 0) {
              // Only count active (non-waitlisted) teams
              const activeRegs = regs.filter(function(r) { return !r.waitlisted; });
              const teamIds = activeRegs.map((r) => r.team_id);
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

// ── Date/Time formatter (Eastern Time) ──────────────────────────────────────
function formatTournamentDateTime(startDate, startTime) {
  if (!startDate) return null;
  try {
    // Build a date string in EST
    const timeStr = startTime || '00:00';
    // Parse as local date in ET by constructing ISO string with ET offset
    // We treat the stored date+time as Eastern Time
    const [year, month, day] = startDate.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    // Format display string
    const dateObj = new Date(year, month - 1, day, hours, minutes);
    const dateFormatted = dateObj.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
    if (startTime) {
      const timeFormatted = dateObj.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true
      });
      return dateFormatted + ' at ' + timeFormatted + ' ET';
    }
    return dateFormatted;
  } catch(e) {
    return startDate + (startTime ? ' ' + startTime + ' ET' : '');
  }
}

async function syncSession() {
  if (!supabaseClient) {
    return;
  }
  // Load webhook URLs and prize pool % from Supabase so all pages have them
  fetchAndCacheWebhookUrls();
  loadPrizePoolPct();
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
  const teams = loadTeams();

  // First: check localStorage users array (legacy path)
  const users = loadUsers();
  const user = users.find((u) => u.email === currentEmail);
  if (user && user.teamId) {
    const t = teams.find((t) => t.id === user.teamId);
    if (t) return t;
  }

  // Second: find a team where this user is the captain or a member
  // This covers users who registered via Supabase and have no localStorage user record
  const found = teams.find((t) => {
    if (t.captain && t.captain.toLowerCase() === currentEmail.toLowerCase()) return true;
    if (Array.isArray(t.members) && t.members.some(m => (m.email || m).toLowerCase() === currentEmail.toLowerCase())) return true;
    return false;
  });
  return found || null;
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

// ── Global real-time: listen to Supabase and re-render on any change ─────────
// This runs once per page load and keeps every user's view in sync with the DB.
function initGlobalRealtime() {
  if (!supabaseClient) return;

  // Helper: re-render whichever sections are visible on the current page
  async function onTournamentsChange() {
    try {
      await syncTournamentsFromBackend();
    } catch(e) { /* ignore */ }

    // Tournaments page
    if (typeof renderActiveTournaments === 'function' && document.getElementById('active-tab')) {
      renderActiveTournaments();
    }
    if (typeof renderUpcomingTournaments === 'function' && document.getElementById('upcoming-tab')) {
      renderUpcomingTournaments();
    }
    if (typeof renderPastChampionsTab === 'function' && document.getElementById('past-tab')) {
      renderPastChampionsTab();
    }
    // Admin page
    if (typeof renderAdminTournaments === 'function' && document.getElementById('admin-tournament-list')) {
      renderAdminTournaments();
    }
    // Tournament detail page — skip global re-render here
    // The bracket has its own dedicated realtime subscription that handles updates
    // Re-rendering here causes race conditions with admin actions
    // Index page past winners
    if (typeof renderPastWinners === 'function' && document.getElementById('past-winners-section')) {
      renderPastWinners();
    }
  }

  async function onTeamsChange() {
    try {
      await syncTeamsFromBackend();
    } catch(e) { /* ignore */ }
    if (typeof renderAdminTeams === 'function' && document.getElementById('admin-teams-table-body')) {
      renderAdminTeams();
    }
  }

  async function onScoresChange() {
    if (typeof renderPendingScores === 'function' && document.getElementById('pending-scores-container')) {
      renderPendingScores();
    }
  }

  async function onProfilesChange() {
    if (typeof renderAdminUsers === 'function' && document.getElementById('admin-users-table-body')) {
      renderAdminUsers();
    }
  }

  // Subscribe to tournaments table
  supabaseClient
    .channel('global-tournaments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, function() {
      onTournamentsChange();
    })
    .subscribe();

  // Subscribe to tournament_registrations table
  supabaseClient
    .channel('global-registrations')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_registrations' }, function() {
      onTournamentsChange();
    })
    .subscribe();

  // Subscribe to score_submissions table
  supabaseClient
    .channel('global-scores')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'score_submissions' }, function() {
      onScoresChange();
    })
    .subscribe();

  // Subscribe to teams table
  supabaseClient
    .channel('global-teams')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, function() {
      onTeamsChange();
    })
    .subscribe();

  // Subscribe to profiles table
  supabaseClient
    .channel('global-profiles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, function() {
      onProfilesChange();
    })
    .subscribe();

  console.log('[Realtime] Global subscriptions active');
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
  // Sync mobile bottom tab bar profile tab
  const tabProfile = document.getElementById('tab-profile');
  if (tabProfile) tabProfile.style.display = userEmail ? 'flex' : 'none';
  // Show admin tab on mobile for admins
  const tabAdmin = document.getElementById('tab-admin');
  if (tabAdmin) tabAdmin.style.display = (userEmail && userEmail === ADMIN_EMAIL) ? 'flex' : 'none';
  // Show hamburger on admin page for admins (mobile only)
  const hamburger = document.getElementById('admin-hamburger');
  if (hamburger) {
    const isMobile = window.innerWidth <= 768;
    hamburger.style.display = (userEmail && userEmail === ADMIN_EMAIL && isMobile) ? 'flex' : 'none';
  }
  // Show admin tab if admin (reuse existing admin-nav logic)
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
    const statusLabels = { 'open': 'Open', 'check_in': '✅ Check-In Open', 'started': 'Started', 'completed': 'Completed' };
    status.textContent = 'Status: ' + (statusLabels[t.status] || t.status || 'open');
    const teamsCount = document.createElement('p');
    // Display current number of teams and maximum slots if defined
    const currentCount = t.teams ? t.teams.length : 0;
    const maxCount = t.maxTeams ? t.maxTeams : null;
    teamsCount.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
    // Prepare start date element if available; we will append after teams count
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
    // Goalie required badge
    if (t.goalieRequired) {
      const goalieBadge = document.createElement('p');
      goalieBadge.style.cssText = 'color:var(--gold);font-size:0.8rem;font-weight:600;margin-top:0.25rem;';
      goalieBadge.textContent = '🥅 Goalie Required';
      card.appendChild(goalieBadge);
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
    badge.classList.add('badge-' + statusText.toLowerCase().replace('-', ''));
    badge.textContent = statusText;
    card.appendChild(badge);
    const title = document.createElement('h3');
    title.textContent = t.name;
    card.appendChild(title);
    const currentCount = t.teams ? t.teams.length : 0;
    const maxCount = t.maxTeams ? t.maxTeams : null;

    // Meta row: teams count
    const metaRow = document.createElement('div');
    metaRow.className = 'card-meta-row';
    const teamsLabel = document.createElement('span');
    teamsLabel.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
    metaRow.appendChild(teamsLabel);
    if (t.startDate) {
      const dateSpan = document.createElement('span');
      dateSpan.textContent = formatTournamentDateTime(t.startDate, t.startTime);
      metaRow.appendChild(dateSpan);
    }
    card.appendChild(metaRow);

    // Progress bar
    if (maxCount) {
      const pct = Math.min(100, Math.round((currentCount / maxCount) * 100));
      const barWrap = document.createElement('div');
      barWrap.className = 'team-progress-bar';
      const barFill = document.createElement('div');
      barFill.className = 'team-progress-fill' + (pct >= 100 ? ' full' : '');
      barFill.style.width = pct + '%';
      barWrap.appendChild(barFill);
      card.appendChild(barWrap);
    }

    // Entry fee + prize pool row
    const fee = parseFloat(t.entry_fee || t.entryFee) || 0;
    const badgeRow = document.createElement('div');
    badgeRow.style.cssText = 'display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.1rem;';
    const feeBadge = document.createElement('span');
    feeBadge.style.cssText = 'display:inline-block;padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:600;' + (fee > 0 ? 'background:rgba(212,160,23,0.15);border:1px solid rgba(212,160,23,0.4);color:#d4a017;' : 'background:rgba(80,200,120,0.1);border:1px solid rgba(80,200,120,0.3);color:#50c878;');
    feeBadge.textContent = fee > 0 ? '💰 $' + fee.toFixed(2) + ' Entry' : '🆓 Free Entry';
    badgeRow.appendChild(feeBadge);
    const prizePool = formatPrizePool(t);
    if (prizePool) {
      const poolBadge = document.createElement('span');
      poolBadge.style.cssText = 'display:inline-block;padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:700;background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.4);color:#ffd700;';
      poolBadge.textContent = '🏆 ' + prizePool + ' Prize';
      badgeRow.appendChild(poolBadge);
    }
    card.appendChild(badgeRow);

    const link = document.createElement('a');
    link.href = 'tournament.html?id=' + encodeURIComponent(t.id);
    link.className = 'button';
    link.textContent = 'View Tournament';
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
    if (t.status === 'check_in') {
      statusText = 'Check-In';
    } else if (maxCount && currentCount >= maxCount) {
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

    // Meta row
    const metaRow2 = document.createElement('div');
    metaRow2.className = 'card-meta-row';
    const teamsLabel2 = document.createElement('span');
    teamsLabel2.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
    metaRow2.appendChild(teamsLabel2);
    if (t.startDate) {
      const dateSpan2 = document.createElement('span');
      dateSpan2.textContent = formatTournamentDateTime(t.startDate, t.startTime);
      metaRow2.appendChild(dateSpan2);
    }
    card.appendChild(metaRow2);

    // Progress bar
    if (maxCount) {
      const pct2 = Math.min(100, Math.round((currentCount / maxCount) * 100));
      const barWrap2 = document.createElement('div');
      barWrap2.className = 'team-progress-bar';
      const barFill2 = document.createElement('div');
      barFill2.className = 'team-progress-fill' + (pct2 >= 100 ? ' full' : '');
      barFill2.style.width = pct2 + '%';
      barWrap2.appendChild(barFill2);
      card.appendChild(barWrap2);
    }

    // Fee + prize badges
    const fee2 = parseFloat(t.entry_fee || t.entryFee) || 0;
    const badgeRow2 = document.createElement('div');
    badgeRow2.style.cssText = 'display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.1rem;';
    const feeBadge2 = document.createElement('span');
    feeBadge2.style.cssText = 'display:inline-block;padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:600;' + (fee2 > 0 ? 'background:rgba(212,160,23,0.15);border:1px solid rgba(212,160,23,0.4);color:#d4a017;' : 'background:rgba(80,200,120,0.1);border:1px solid rgba(80,200,120,0.3);color:#50c878;');
    feeBadge2.textContent = fee2 > 0 ? '💰 $' + fee2.toFixed(2) + ' Entry' : '🆓 Free Entry';
    badgeRow2.appendChild(feeBadge2);
    const prizePool2 = formatPrizePool(t);
    if (prizePool2) {
      const poolBadge2 = document.createElement('span');
      poolBadge2.style.cssText = 'display:inline-block;padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:700;background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.4);color:#ffd700;';
      poolBadge2.textContent = '🏆 ' + prizePool2 + ' Prize';
      badgeRow2.appendChild(poolBadge2);
    }
    card.appendChild(badgeRow2);

    const link = document.createElement('a');
    link.href = 'tournament.html?id=' + encodeURIComponent(t.id);
    link.className = 'button';
    link.textContent = 'View Tournament';
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
      const adminRow = document.createElement('div');
      adminRow.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-top:0.5rem;flex-wrap:wrap;';

      // Edit champion name button
      const editChampBtn = document.createElement('button');
      editChampBtn.textContent = '✏️ Edit Champion';
      editChampBtn.className = 'button';
      editChampBtn.style.cssText = 'font-size:0.75rem;padding:0.25rem 0.6rem;';
      editChampBtn.addEventListener('click', async function() {
        // Toggle inline edit
        const existingEdit = card.querySelector('.champ-edit-row');
        if (existingEdit) { existingEdit.remove(); return; }
        const editRow = document.createElement('div');
        editRow.className = 'champ-edit-row';
        editRow.style.cssText = 'margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = t.winner || '';
        input.placeholder = 'Enter correct champion name';
        input.style.cssText = 'flex:1;min-width:150px;padding:0.35rem 0.5rem;background:var(--surface);border:1px solid var(--gold);border-radius:var(--radius-sm);color:var(--text);font-size:0.85rem;';
        const saveBtn2 = document.createElement('button');
        saveBtn2.textContent = 'Save';
        saveBtn2.className = 'button';
        saveBtn2.style.cssText = 'font-size:0.75rem;padding:0.25rem 0.6rem;';
        const cancelBtn2 = document.createElement('button');
        cancelBtn2.textContent = 'Cancel';
        cancelBtn2.className = 'button delete';
        cancelBtn2.style.cssText = 'font-size:0.75rem;padding:0.25rem 0.6rem;';
        cancelBtn2.addEventListener('click', function() { editRow.remove(); });
        saveBtn2.addEventListener('click', async function() {
          const newWinner = input.value.trim();
          if (!newWinner) { alert('Enter a champion name.'); return; }
          saveBtn2.disabled = true;
          saveBtn2.textContent = '...';
          // Update in backend
          try {
            const res = await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(t.id), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ winner: newWinner }),
            });
            const data = await res.json();
            if (!data.ok) throw new Error('Backend failed');
            // Update localStorage
            const ts = loadTournaments();
            const idx2 = ts.findIndex(x => x.id === t.id);
            if (idx2 !== -1) { ts[idx2].winner = newWinner; saveTournaments(ts); }
            editRow.remove();
            champ.textContent = 'Champion: ' + newWinner;
            t.winner = newWinner;
          } catch(err) {
            alert('Save failed: ' + err.message);
            saveBtn2.disabled = false;
            saveBtn2.textContent = 'Save';
          }
        });
        editRow.appendChild(input);
        editRow.appendChild(saveBtn2);
        editRow.appendChild(cancelBtn2);
        card.appendChild(editRow);
        input.focus();
        input.select();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'delete';
      deleteBtn.style.cssText = 'font-size:0.75rem;padding:0.25rem 0.6rem;';
      deleteBtn.addEventListener('click', function() {
        deleteTournament(t.id);
        renderPastChampionsTab();
      });
      adminRow.appendChild(editChampBtn);
      adminRow.appendChild(deleteBtn);
      card.appendChild(adminRow);
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
    const statusLabels = { 'open': 'Open', 'check_in': '✅ Check-In Open', 'started': 'Started', 'completed': 'Completed' };
    status.textContent = 'Status: ' + (statusLabels[t.status] || t.status || 'open');
    // Display current team count and maximum
    const teamsCount = document.createElement('p');
    const currentCount = t.teams ? t.teams.length : 0;
    const maxCount = t.maxTeams ? t.maxTeams : null;
    teamsCount.textContent = 'Teams: ' + currentCount + (maxCount ? ' / ' + maxCount : '');
    // Start date + time
    let startEl = null;
    if (t.startDate) {
      startEl = document.createElement('p');
      startEl.textContent = 'Starts: ' + formatTournamentDateTime(t.startDate, t.startTime);
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
    } else if (t.status === 'check_in') {
      startBtn.textContent = 'Start';
      startBtn.addEventListener('click', () => { startTournament(t.id); });
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
    // ── Check-In button (free tournaments only) ──
    const feeForCI = parseFloat(t.entry_fee || t.entryFee) || 0;
    if (feeForCI === 0 && t.status !== 'started' && t.status !== 'completed') {
      if (t.status !== 'check_in') {
        const openCIBtn = document.createElement('button');
        openCIBtn.className = 'button';
        openCIBtn.textContent = '✅ Open Check-In';
        openCIBtn.style.cssText = 'background:linear-gradient(135deg,#50c878,#2ecc71);color:#000;font-weight:800;font-size:0.78rem;padding:0.3rem 0.7rem;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;';
        openCIBtn.addEventListener('click', async function() {
          openCIBtn.disabled = true;
          openCIBtn.textContent = 'Opening...';
          await openCheckIn(t.id);
          renderAdminTournaments();
        });
        actions.appendChild(openCIBtn);
      } else {
        // Close check-in button
        const closeCIBtn = document.createElement('button');
        closeCIBtn.className = 'button';
        closeCIBtn.textContent = '🔒 Close Check-In';
        closeCIBtn.style.cssText = 'background:rgba(80,200,120,0.15);border:1px solid #50c878;color:#50c878;font-size:0.78rem;padding:0.3rem 0.7rem;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;';
        closeCIBtn.addEventListener('click', async function() {
          closeCIBtn.disabled = true;
          await closeCheckIn(t.id);
          renderAdminTournaments();
        });
        actions.appendChild(closeCIBtn);
      }
    }

    // Post Registration Update to Discord (only when status is open)
    if (!t.status || t.status === 'open') {
      const updateBtn = document.createElement('button');
      updateBtn.className = 'button';
      updateBtn.textContent = '📣 Post Update';
      updateBtn.title = 'Post registration status to Discord announcements';
      updateBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,199,44,0.4);color:var(--gold);font-size:0.78rem;padding:0.3rem 0.7rem;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;';
      updateBtn.addEventListener('click', function() {
        // Fetch latest tournament data so team count is fresh
        var latest = loadTournaments().find(function(x) { return x.id === t.id; });
        if (!latest) latest = t;
        announceRegistrationUpdate(latest);
        updateBtn.textContent = '✅ Posted!';
        updateBtn.disabled = true;
        setTimeout(function() {
          updateBtn.textContent = '📣 Post Update';
          updateBtn.disabled = false;
        }, 3000);
      });
      actions.appendChild(updateBtn);
    }
    actions.appendChild(startBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    // Force Complete button — only show for started tournaments
    if (t.status === 'started') {
      const forceCompleteBtn = document.createElement('button');
      forceCompleteBtn.className = 'button';
      forceCompleteBtn.textContent = '🏆 Force Complete';
      forceCompleteBtn.style.cssText = 'font-size:0.78rem;padding:0.3rem 0.7rem;background:transparent;border:1px solid var(--gold);color:var(--gold);border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;';
      forceCompleteBtn.addEventListener('click', async function() {
        const winnerName = prompt('Enter the champion team name to mark this tournament as complete:');
        if (!winnerName || !winnerName.trim()) return;
        const confirmed = confirm('Mark "' + t.name + '" as complete with champion: ' + winnerName.trim() + '?');
        if (!confirmed) return;
        let tournaments2 = loadTournaments();
        const tIdx2 = tournaments2.findIndex(function(x) { return x.id === t.id; });
        if (tIdx2 === -1) return;
        tournaments2[tIdx2].status = 'completed';
        tournaments2[tIdx2].winner = winnerName.trim();
        saveTournaments(tournaments2);
        try {
          await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(t.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed', winner: winnerName.trim(), bracket: tournaments2[tIdx2].bracket }),
          });
        } catch(e) { console.error('Force complete backend error:', e); }
        try { announceTournamentComplete(t.name, winnerName.trim()); } catch(e) {}
        renderAdminTournaments();
        alert('Tournament marked as complete. Champion: ' + winnerName.trim());
      });
      actions.appendChild(forceCompleteBtn);
    }
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
// Cached data for search filtering
let _cachedUsersArray = [];
let _cachedTeamsArray = [];
let _cachedDiscordMap = {};

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
  // Sort alphabetically by email
  usersArray.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  _cachedUsersArray = usersArray;

  // Wire up search
  const searchInput = document.getElementById('users-search');
  if (searchInput && !searchInput._wired) {
    searchInput._wired = true;
    searchInput.addEventListener('input', function() {
      renderUsersRows(_cachedUsersArray, this.value.toLowerCase().trim());
    });
  }

  renderUsersRows(usersArray, searchInput ? searchInput.value.toLowerCase().trim() : '');
}

function renderUsersRows(usersArray, query) {
  const tbody = document.getElementById('admin-users-table-body');
  if (!tbody) return;
  const filtered = query
    ? usersArray.filter(function(u) {
        return u.email.includes(query) ||
          u.discord.toLowerCase().includes(query) ||
          u.gamertag.toLowerCase().includes(query);
      })
    : usersArray;
  tbody.innerHTML = '';
  if (filtered.length === 0) {
    tbody.innerHTML = '<p style="padding:1rem;color:var(--text-muted);">' + (query ? 'No users match.' : 'No users found.') + '</p>';
    return;
  }
  filtered.forEach(function(u) {
    var dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
    var card = document.createElement('div');
    card.className = 'admin-card';
    var header = document.createElement('div');
    header.className = 'admin-card-header';
    header.innerHTML = '<span class="admin-card-name">' + u.email + '</span><span class="admin-card-chevron">&#8250;</span>';
    var details = document.createElement('div');
    details.className = 'admin-card-details';
    details.style.display = 'none';
    details.innerHTML =
      '<div class="admin-card-row"><span class="admin-card-label">Discord</span><span class="admin-card-value">' + (u.discord || 'Not set') + '</span></div>' +
      '<div class="admin-card-row"><span class="admin-card-label">Gamertag</span><span class="admin-card-value">' + (u.gamertag || '—') + '</span></div>' +
      '<div class="admin-card-row"><span class="admin-card-label">Joined</span><span class="admin-card-value">' + dateStr + '</span></div>';
    var deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete User';
    deleteBtn.className = 'delete admin-card-delete';
    deleteBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (!confirm('Delete user ' + u.email + '?')) return;
      if (supabaseClient) {
        await supabaseClient.from('profiles').delete().eq('email', u.email);
        var ct = await supabaseClient.from('teams').select('id').eq('captain', u.email);
        if (ct.data && ct.data.length > 0) {
          for (var t of ct.data) {
            await supabaseClient.from('tournament_registrations').delete().eq('team_id', t.id);
            await supabaseClient.from('teams').delete().eq('id', t.id);
          }
          var localTeams = loadTeams().filter(function(lt) { return lt.captain !== u.email; });
          saveTeams(localTeams);
        }
      }
      var localUsers = loadUsers().filter(function(lu) { return lu.email !== u.email; });
      saveUsers(localUsers);
      renderAdminUsers();
    });
    details.appendChild(deleteBtn);
    card.appendChild(header);
    card.appendChild(details);
    header.addEventListener('click', function() {
      var open = details.style.display !== 'none';
      details.style.display = open ? 'none' : 'block';
      card.classList.toggle('admin-card--open', !open);
    });
    tbody.appendChild(card);
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
  // Sort alphabetically by name
  teamsArray.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  _cachedTeamsArray = teamsArray;
  _cachedDiscordMap = discordMap;

  // Wire up search
  const searchInput = document.getElementById('teams-search');
  if (searchInput && !searchInput._wired) {
    searchInput._wired = true;
    searchInput.addEventListener('input', function() {
      renderTeamsRows(_cachedTeamsArray, _cachedDiscordMap, this.value.toLowerCase().trim());
    });
  }

  renderTeamsRows(teamsArray, discordMap, searchInput ? searchInput.value.toLowerCase().trim() : '');
}

function renderTeamsRows(teamsArray, discordMap, query) {
  const tbody = document.getElementById('admin-teams-table-body');
  if (!tbody) return;
  const filtered = query
    ? teamsArray.filter(function(t) {
        return t.name.toLowerCase().includes(query) ||
          (t.captain || '').toLowerCase().includes(query) ||
          (discordMap[(t.captain || '').toLowerCase()] || '').toLowerCase().includes(query);
      })
    : teamsArray;
  tbody.innerHTML = '';
  if (filtered.length === 0) {
    tbody.innerHTML = '<p style="padding:1rem;color:var(--text-muted);">' + (query ? 'No teams match.' : 'No teams found.') + '</p>';
    return;
  }
  filtered.forEach(function(team) {
    var emailKey = (team.captain || '').toLowerCase();
    var discordVal = discordMap[emailKey] || '—';
    var card = document.createElement('div');
    card.className = 'admin-card';
    var header = document.createElement('div');
    header.className = 'admin-card-header';
    header.innerHTML = '<span class="admin-card-name">' + team.name + '</span><span class="admin-card-chevron">&#8250;</span>';
    var details = document.createElement('div');
    details.className = 'admin-card-details';
    details.style.display = 'none';
    details.innerHTML =
      '<div class="admin-card-row"><span class="admin-card-label">Captain</span><span class="admin-card-value">' + (team.captain || '—') + '</span></div>' +
      '<div class="admin-card-row"><span class="admin-card-label">Discord</span><span class="admin-card-value">' + discordVal + '</span></div>';
    var deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Team';
    deleteBtn.className = 'delete admin-card-delete';
    deleteBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (!confirm('Delete team "' + team.name + '"?')) return;
      try {
        await fetch(API_BASE_URL + '/api/teams/' + encodeURIComponent(team.id), { method: 'DELETE' }).catch(function(){});
        if (supabaseClient) {
          await supabaseClient.from('teams').delete().eq('id', team.id);
          await supabaseClient.from('tournament_registrations').delete().eq('team_id', team.id);
        }
        var localTeams = loadTeams().filter(function(t) { return t.id !== team.id; });
        saveTeams(localTeams);
      } catch(err) { console.error(err); }
      renderAdminTeams();
    });
    details.appendChild(deleteBtn);
    card.appendChild(header);
    card.appendChild(details);
    header.addEventListener('click', function() {
      var open = details.style.display !== 'none';
      details.style.display = open ? 'none' : 'block';
      card.classList.toggle('admin-card--open', !open);
    });
    tbody.appendChild(card);
  });
}
async function createTournamentFromForm() {
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
  const goalieInput = document.getElementById('tournament-goalie');
  const goalieRequired = goalieInput ? goalieInput.value === 'true' : false;
  // Entry fee — read from admin form input, default to 0 (free)
  const entryFeeInput = document.getElementById('entry-fee-input');
  const entryFee = entryFeeInput && entryFeeInput.value ? parseFloat(entryFeeInput.value) || 0 : 0;
  const timeInput = document.getElementById('tournament-start-time');
  const startTime = timeInput && timeInput.value ? timeInput.value : null; // HH:MM in EST
  const newTournament = {
    id,
    name,
    teams: [],
    maxTeams: maxVal,
    created: new Date().toISOString(),
    startDate: dateInput && dateInput.value ? dateInput.value : null,
    startTime: startTime,
    status: 'open',
    bracket: [],
    winner: null,
    password: tournamentPassword,
    goalieRequired: goalieRequired,
    entryFee: entryFee,
  };
  tournaments.push(newTournament);
  saveTournaments(tournaments);
  // Fire Discord webhook — new tournament announced
  try { announceTournamentCreated(name, newTournament.startDate, maxVal, goalieRequired, entryFee, newTournament.startTime); }
  catch(e) { console.warn('[Webhook] Tournament created error:', e); }
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
        startTime: newTournament.startTime,
        password: newTournament.password || null,
        entryFee: entryFee,
        goalieRequired: goalieRequired,
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
  if (timeInput) {
    timeInput.value = '';
  }
  if (passwordInput) {
    passwordInput.value = '';
  }
  // Reset entry fee
  if (entryFeeInput) {
    entryFeeInput.value = '';
  }
  // Reset goalie toggle
  const goalieToggleEl = document.getElementById('goalie-toggle');
  const goalieInputEl = document.getElementById('tournament-goalie');
  const goalieLabelEl = document.getElementById('goalie-toggle-label');
  if (goalieToggleEl) {
    goalieToggleEl.dataset.on = 'false';
    goalieToggleEl.style.background = 'var(--border)';
    const thumb = goalieToggleEl.querySelector('div');
    if (thumb) thumb.style.transform = 'translateX(0)';
  }
  if (goalieInputEl) goalieInputEl.value = 'false';
  if (goalieLabelEl) { goalieLabelEl.textContent = 'No'; goalieLabelEl.style.color = 'var(--text-muted)'; }
  // Sync from backend so the canonical ID is used and no duplicates appear.
  // Wait for sync to complete before re-rendering so the new tournament shows.
  if (typeof syncTournamentsFromBackend === 'function') {
    try {
      await syncTournamentsFromBackend();
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

// Allow the admin to edit tournament details via a clean modal
function editTournament(id) {
  const tournaments = loadTournaments();
  const index = tournaments.findIndex((t) => String(t.id) === String(id));
  if (index === -1) return;
  const t = tournaments[index];
  const currentTeams = t.teams ? t.teams.length : 0;
  const started = t.status === 'started' || t.status === 'completed';

  // Remove any existing edit modal
  document.getElementById('edit-tourney-modal')?.remove();
  document.getElementById('edit-tourney-overlay')?.remove();

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'edit-tourney-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:2000;';
  document.body.appendChild(overlay);

  // Modal
  const modal = document.createElement('div');
  modal.id = 'edit-tourney-modal';
  modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2001;background:#1a1a2e;border:1px solid #d4a017;border-radius:12px;padding:2rem;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.6);';

  modal.innerHTML =
    '<h2 style="font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.06em;color:#d4a017;font-size:1.3rem;margin:0 0 1.5rem;">✏️ Edit Tournament</h2>' +

    '<label style="display:block;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.3rem;">Tournament Name</label>' +
    '<input id="et-name" type="text" value="' + (t.name || '').replace(/"/g, '&quot;') + '" style="width:100%;padding:0.55rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.95rem;margin-bottom:1rem;box-sizing:border-box;" />' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.3rem;">Start Date</label>' +
        '<input id="et-date" type="date" value="' + (t.startDate || '') + '" style="width:100%;padding:0.55rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.9rem;box-sizing:border-box;" />' +
      '</div>' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.3rem;">Start Time (ET)</label>' +
        '<input id="et-time" type="time" value="' + (t.startTime || '') + '" style="width:100%;padding:0.55rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.9rem;box-sizing:border-box;" />' +
      '</div>' +
    '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.3rem;">Max Teams</label>' +
        '<input id="et-max" type="number" min="' + currentTeams + '" value="' + (t.maxTeams || 8) + '" ' + (started ? 'disabled' : '') + ' style="width:100%;padding:0.55rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.9rem;box-sizing:border-box;opacity:' + (started ? '0.5' : '1') + ';" />' +
      '</div>' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.3rem;">Password (optional)</label>' +
        '<input id="et-password" type="text" value="' + (t.password || '') + '" placeholder="Leave blank for open" style="width:100%;padding:0.55rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.9rem;box-sizing:border-box;" />' +
      '</div>' +
    '</div>' +

    '<label style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;cursor:pointer;">' +
      '<input id="et-goalie" type="checkbox" ' + (t.goalieRequired ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:#d4a017;cursor:pointer;" />' +
      '<span style="font-size:0.9rem;color:var(--text);">🥅 Goalie Required</span>' +
    '</label>' +

    '<div style="display:flex;gap:0.75rem;">' +
      '<button id="et-save" style="flex:1;background:linear-gradient(135deg,#d4a017,#f0c040);color:#1a1a2e;border:none;border-radius:var(--radius-sm);padding:0.75rem;font-family:Barlow Condensed,sans-serif;font-size:1rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;cursor:pointer;">Save Changes</button>' +
      '<button id="et-cancel" style="flex:1;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.75rem;font-size:0.9rem;cursor:pointer;">Cancel</button>' +
    '</div>' +
    '<p id="et-status" style="color:#ff6b6b;font-size:0.85rem;margin-top:0.75rem;display:none;"></p>';

  document.body.appendChild(modal);

  function closeModal() {
    modal.remove();
    overlay.remove();
  }

  overlay.addEventListener('click', closeModal);
  document.getElementById('et-cancel').addEventListener('click', closeModal);

  document.getElementById('et-save').addEventListener('click', async function() {
    const saveBtn = document.getElementById('et-save');
    const statusEl = document.getElementById('et-status');
    const newName = document.getElementById('et-name').value.trim();
    const newDate = document.getElementById('et-date').value.trim();
    const newTime = document.getElementById('et-time').value.trim();
    const newMax = parseInt(document.getElementById('et-max').value, 10);
    const newPassword = document.getElementById('et-password').value.trim();
    const newGoalie = document.getElementById('et-goalie').checked;

    if (!newName) { statusEl.textContent = 'Tournament name cannot be empty.'; statusEl.style.display = 'block'; return; }
    if (!started && (!newMax || newMax < 2 || newMax < currentTeams)) {
      statusEl.textContent = 'Max teams must be at least ' + Math.max(2, currentTeams) + '.';
      statusEl.style.display = 'block'; return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    // Update local
    const ts = loadTournaments();
    const i = ts.findIndex((x) => String(x.id) === String(id));
    if (i !== -1) {
      ts[i].name = newName;
      ts[i].startDate = newDate || null;
      ts[i].startTime = newTime || null;
      if (!started) ts[i].maxTeams = newMax;
      ts[i].password = newPassword || null;
      ts[i].goalieRequired = newGoalie;
      saveTournaments(ts);
    }

    // Save to Supabase + backend
    const patchData = {
      name: newName,
      startDate: newDate || null,
      startTime: newTime || null,
      maxTeams: started ? undefined : newMax,
      goalieRequired: newGoalie,
    };

    try {
      if (supabaseClient) {
        await supabaseClient.from('tournaments').update({
          name: newName,
          start_date: newDate || null,
          start_time: newTime || null,
          goalie_required: newGoalie,
          ...(started ? {} : { max_teams: newMax }),
          password: newPassword || null,
        }).eq('id', id);
      }
      await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchData),
      }).catch(() => {});
    } catch(e) {
      console.error('Edit tournament save error:', e);
    }

    closeModal();
    renderAdminTournaments();
  });
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

// ── Discord Gate ─────────────────────────────────────────────────────────────
// Shows a modal asking if the user has joined the Discord before registration.
// Stores discord_confirmed = true on their Supabase profile once they confirm.
// Never shown again after first confirmation.

async function checkDiscordGate(onConfirmed) {
  // Check profile for existing confirmation
  if (supabaseClient) {
    try {
      const email = getCurrentUser();
      if (email) {
        const { data } = await supabaseClient
          .from('profiles')
          .select('discord_confirmed')
          .eq('email', email)
          .single();
        if (data && data.discord_confirmed) {
          // Already confirmed discord — always show check-in reminder on register
          showCheckInReminderModal(onConfirmed);
          return;
        }
      }
    } catch(e) { /* ignore, show modal as fallback */ }
  }

  // Build modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'discord-gate-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--card);border:1px solid var(--gold);border-radius:var(--radius-lg);padding:2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 0 40px rgba(255,199,44,0.15);';

  const discordLogo = '<svg width="32" height="32" viewBox="0 0 24 24" fill="#5865F2" style="margin-bottom:0.75rem;"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.057a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>';

  modal.innerHTML = discordLogo +
    '<h2 style="font-family:Barlow Condensed,sans-serif;font-size:1.4rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:var(--gold);margin-bottom:0.5rem;">Join the Discord First</h2>' +
    '<p style="color:var(--text-muted);font-size:0.9rem;line-height:1.5;margin-bottom:1.25rem;">To compete in Reggy Sosa tournaments you must be in the official Discord server. All match codes, announcements, and opponent communication happen there.</p>' +
    '<a href="' + DISCORD_INVITE + '" target="_blank" id="discord-join-link" style="display:inline-flex;align-items:center;gap:0.5rem;background:#5865F2;color:#fff;padding:0.6rem 1.4rem;border-radius:var(--radius-sm);font-family:Barlow Condensed,sans-serif;font-weight:700;font-size:1rem;text-transform:uppercase;letter-spacing:0.06em;text-decoration:none;margin-bottom:1rem;transition:opacity 0.2s;">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.057a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>' +
      'Join Discord Server' +
    '</a>' +
    '<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:1.25rem;">Already a member? Click below to confirm and register.</p>' +
    '<div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;">' +
      '<button id="discord-confirm-btn" class="button" style="font-size:0.9rem;padding:0.5rem 1.25rem;">✅ Ive Joined — Register Me</button>' +
      '<button id="discord-cancel-btn" class="button delete" style="font-size:0.9rem;padding:0.5rem 1rem;">Cancel</button>' +
    '</div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('discord-cancel-btn').addEventListener('click', function() {
    overlay.remove();
  });

  document.getElementById('discord-confirm-btn').addEventListener('click', async function() {
    const confirmBtn = document.getElementById('discord-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving...';

    // Save discord_confirmed to Supabase profile
    if (supabaseClient) {
      try {
        const email = getCurrentUser();
        if (email) {
          await supabaseClient
            .from('profiles')
            .update({ discord_confirmed: true })
            .eq('email', email);
        }
      } catch(e) { /* ignore — still proceed */ }
    }

    overlay.remove();
    // Show check-in reminder before completing registration
    showCheckInReminderModal(onConfirmed);
  });

  // Close on overlay click (outside modal)
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
}


// Shows check-in reminder every time a team registers for a tournament
async function showCheckInReminderModal(onConfirmed) {
  // Always show — check-in is mandatory every tournament

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--card);border:1px solid var(--gold);border-radius:var(--radius-lg);padding:2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 0 40px rgba(255,199,44,0.2);';

  modal.innerHTML =
    '<div style="font-size:2.5rem;margin-bottom:0.75rem;">⏰</div>' +
    '<h2 style="font-family:Barlow Condensed,sans-serif;font-size:1.4rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:var(--gold);margin-bottom:0.75rem;">Check-In Required</h2>' +
    '<p style="color:var(--text);font-size:0.95rem;line-height:1.6;margin-bottom:1rem;">' +
      'Hey! Be on the lookout to check in before the tournament starts.' +
    '</p>' +
    '<div style="background:rgba(255,199,44,0.08);border:1px solid rgba(255,199,44,0.3);border-radius:var(--radius-sm);padding:1rem;margin-bottom:1.25rem;text-align:left;">' +
      '<p style="color:var(--gold);font-weight:700;font-size:0.9rem;margin:0 0 0.5rem;">📋 What you need to know:</p>' +
      '<p style="color:var(--text-muted);font-size:0.85rem;line-height:1.6;margin:0;">' +
        '• Every team must check in <strong style="color:var(--text);">10 minutes before</strong> the tournament starts to hold their spot.<br>' +
        '• If you do not check in by the start time, your spot gets cycled out to the next team waiting in line.<br>' +
        '• Watch the <strong style="color:var(--text);">Discord announcements</strong> channel — we will ping when check-in opens.' +
      '</p>' +
    '</div>' +
    '<button id="checkin-reminder-got-it" class="button" style="width:100%;font-size:1rem;padding:0.65rem;">Got It — Register Me</button>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('checkin-reminder-got-it').addEventListener('click', async function() {
    const btn = document.getElementById('checkin-reminder-got-it');
    btn.disabled = true;
    btn.textContent = 'Registering...';

    overlay.remove();
    onConfirmed();
  });

  // Close on outside click — don't proceed, user must acknowledge
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
}

// ═══════════════════════════════════════════════════════════
// CHECK-IN & WAITLIST SYSTEM
// ═══════════════════════════════════════════════════════════

// Open check-in for a tournament (admin only)
async function openCheckIn(tournamentId) {
  try {
    if (supabaseClient) {
      await supabaseClient.from('tournaments').update({ status: 'check_in' }).eq('id', tournamentId);
    }
    await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournamentId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'check_in' }),
    }).catch(() => {});
    // Fire Discord ping
    try { announceCheckInOpen(tournamentId); } catch(e) {}
    // Update local
    const ts = loadTournaments();
    const i = ts.findIndex(function(t) { return String(t.id) === String(tournamentId); });
    if (i !== -1) { ts[i].status = 'check_in'; saveTournaments(ts); }
  } catch(e) { console.error('openCheckIn error:', e); }
}

// Close check-in (admin sets back to open so they can review before starting)
async function closeCheckIn(tournamentId) {
  try {
    if (supabaseClient) {
      await supabaseClient.from('tournaments').update({ status: 'open' }).eq('id', tournamentId);
    }
    await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournamentId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'open' }),
    }).catch(() => {});
    const ts = loadTournaments();
    const i = ts.findIndex(function(t) { return String(t.id) === String(tournamentId); });
    if (i !== -1) { ts[i].status = 'open'; saveTournaments(ts); }
  } catch(e) { console.error('closeCheckIn error:', e); }
}

// Player checks in
async function checkInTeam(tournamentId, teamId) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from('tournament_registrations')
      .update({ checked_in: true })
      .eq('tournament_id', String(tournamentId))
      .eq('team_id', String(teamId));
    return !error;
  } catch(e) { console.error('checkInTeam error:', e); return false; }
}

// Join waitlist (free tournaments only)
async function joinWaitlist(tournamentId, teamId) {
  if (!supabaseClient) return false;
  try {
    // Check if already registered (active or waitlisted)
    const { data: existing2 } = await supabaseClient
      .from('tournament_registrations')
      .select('id, waitlisted')
      .eq('tournament_id', String(tournamentId))
      .eq('team_id', String(teamId))
      .limit(1);
    if (existing2 && existing2.length > 0) {
      if (!existing2[0].waitlisted) return false; // already active
      return true; // already on waitlist
    }
    // Get max waitlist position
    const { data: wlRows } = await supabaseClient
      .from('tournament_registrations')
      .select('waitlist_position')
      .eq('tournament_id', String(tournamentId))
      .eq('waitlisted', true)
      .order('waitlist_position', { ascending: false })
      .limit(1);
    const nextPos = (wlRows && wlRows.length > 0 && wlRows[0].waitlist_position)
      ? wlRows[0].waitlist_position + 1 : 1;
    const { error } = await supabaseClient
      .from('tournament_registrations')
      .insert({
        tournament_id: String(tournamentId),
        team_id: String(teamId),
        waitlisted: true,
        waitlist_position: nextPos,
        paid: false,
      });
    return !error;
  } catch(e) { console.error('joinWaitlist error:', e); return false; }
}

// Promote waitlisted team to active (admin action)
async function promoteFromWaitlist(tournamentId, teamId, teamName) {
  if (!supabaseClient) return false;
  try {
    await supabaseClient
      .from('tournament_registrations')
      .update({ waitlisted: false, waitlist_position: null })
      .eq('tournament_id', String(tournamentId))
      .eq('team_id', String(teamId));
    // Add to tournament.teams in localStorage
    const ts = loadTournaments();
    const i = ts.findIndex(function(t) { return String(t.id) === String(tournamentId); });
    if (i !== -1) {
      if (!ts[i].teams) ts[i].teams = [];
      if (!ts[i].teams.some(function(t) { return String(t.id) === String(teamId); })) {
        ts[i].teams.push({ id: teamId, name: teamName });
      }
      saveTournaments(ts);
    }
    // DM the team captain via Discord bot if possible
    try { announceWaitlistPromotion(teamName, tournamentId); } catch(e) {}
    return true;
  } catch(e) { console.error('promoteFromWaitlist error:', e); return false; }
}

// Discord ping for check-in open
function announceCheckInOpen(tournamentId) {
  const ts = loadTournaments();
  const t = ts.find(function(x) { return String(x.id) === String(tournamentId); });
  if (!t) return;
  // Use dedicated check-in webhook, fall back to registrations webhook
  const webhookUrl = getWebhookUrl('checkIn') || getWebhookUrl('registrations');
  if (!webhookUrl) return;
  const startStr = formatTournamentDateTime(t.startDate, t.startTime) || 'TBD';
  const tournamentUrl = 'https://reggysosa.com/tournament.html?id=' + t.id;
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '@everyone',
      embeds: [{
        title: '✅ Check-In Is Now Open — ' + t.name,
        description: 'Check-in is now open for **' + t.name + '**! Head to reggysosa.com to confirm your spot. Teams that do not check in by start time may be removed. Check in here: ' + tournamentUrl,
        color: 0xd4a017,
        fields: [
          { name: '📅 Start Time', value: startStr, inline: true },
          { name: '👥 Teams Registered', value: String((t.teams || []).length) + (t.maxTeams ? ' / ' + t.maxTeams : ''), inline: true },
        ],
        footer: { text: 'reggysosa.com — CHEL Tournaments' },
      }],
    }),
  }).catch(() => {});
}

// Discord DM placeholder for waitlist promotion
function announceWaitlistPromotion(teamName, tournamentId) {
  const ts = loadTournaments();
  const t = ts.find(function(x) { return String(x.id) === String(tournamentId); });
  if (!t) return;
  const webhookUrl = getWebhookUrl('teamRegistrations');
  if (!webhookUrl) return;
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: '🎉 Waitlist Promotion!',
        description: '**' + teamName + '** has been moved from the waitlist into **' + t.name + '**! Head to reggysosa.com to check in and confirm your spot.',
        color: 0x50c878,
      }],
    }),
  }).catch(() => {});
}

function registerTeamToTournament(tournamentId, teamId) {
  let tournaments = loadTournaments();
  const idx = tournaments.findIndex((t) => String(t.id) === String(tournamentId));
  if (idx === -1) {
    console.warn("Tournament not in localStorage, firing backend registration directly.");
    try {
      fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(tournamentId)}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      }).catch(() => {});
    } catch (err) { console.error("Failed to register team on backend:", err); }
    alert("Team registered successfully.");
    return;
  }
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

  // Fire Discord registration webhook
  try {
    var _tName = tournament.name || String(tournamentId);
    var _total = tournament.teams.length;
    var _max = tournament.max_teams || tournament.maxTeams || null;
    var _fee = tournament.entry_fee || tournament.entryFee || 0;
    announceTeamRegistration(teamObj.name, _tName, _total, _max, _fee);
  } catch(e) { console.warn('[Webhook] Registration error:', e); }

  // Persist the registration to the back‑end.
  try {
    fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(tournamentId)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: teamObj.id }),
    }).catch(() => { /* ignore errors */ });
  } catch (err) {
    console.error('Failed to register team on backend:', err);
  }
  // Sync tournaments from back-end after registration
  if (typeof syncTournamentsFromBackend === 'function') {
    try {
      syncTournamentsFromBackend().catch(() => { /* ignore errors */ });
    } catch (_) { /* ignore */ }
  }
  alert('Team registered successfully.');
  // Re-render details view (if on details page)
  // Note: caller should call renderTournamentDetails separately if needed
}

// Remove a team from a tournament (admin only)
function removeTeamFromTournament(tournamentId, teamId) {
  let tournaments = loadTournaments();
  const idx = tournaments.findIndex((t) => String(t.id) === String(tournamentId));
  if (idx === -1) return;
  const tournament = tournaments[idx];

  // Find team name before removing
  const teamObj = (tournament.teams || []).find((t) => t.id === teamId);
  const teamName = teamObj ? teamObj.name : null;

  // Remove from teams list
  if (tournament.teams) {
    tournament.teams = tournament.teams.filter((team) => team.id !== teamId);
  }

  // If tournament has started, scrub the team from ALL bracket slots
  // Use case-insensitive match to handle manual edits via Edit Match panel
  if (tournament.status === 'started' && teamName && Array.isArray(tournament.bracket)) {
    const nameLower = teamName.toLowerCase().trim();
    tournament.bracket.forEach(function(round) {
      round.forEach(function(match) {
        const t1Lower = (match.team1 || '').toLowerCase().trim();
        const t2Lower = (match.team2 || '').toLowerCase().trim();
        const winLower = (match.winner || '').toLowerCase().trim();
        if (t1Lower === nameLower) {
          match.team1 = 'BYE';
          match.winner = null;
          match.code = generateCode(null);
        }
        if (t2Lower === nameLower) {
          match.team2 = 'BYE';
          match.winner = null;
          match.code = generateCode(null);
        }
        if (winLower === nameLower) {
          match.winner = null;
        }
      });
    });
  }

  tournaments[idx] = tournament;
  saveTournaments(tournaments);

  // Persist to backend
  try {
    fetch(
      `${API_BASE_URL}/api/tournaments/${encodeURIComponent(tournamentId)}/register/${encodeURIComponent(teamId)}`,
      { method: 'DELETE' }
    ).then(() => {
      // Also patch bracket if tournament started
      if (tournament.status === 'started') {
        fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(tournamentId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bracket: tournament.bracket }),
        }).catch(() => {});
      }
      if (typeof syncTournamentsFromBackend === 'function') {
        syncTournamentsFromBackend().catch(() => {});
      }
    }).catch(() => {});
  } catch (err) {
    console.error('Failed to remove team on backend:', err);
  }

  alert('Team removed from tournament.' + (tournament.status === 'started' ? ' Their bracket slots have been replaced with BYE.' : ''));
}

// Report a match result for a given tournament. Updates the winner and propagates
// the winner to the next round. Only called by admins.
async function reportMatchResult(tournamentId, roundIndex, matchIndex, winnerName, t1Score, t2Score) {
  let tournaments = loadTournaments();
  const idx = tournaments.findIndex((t) => String(t.id) === String(tournamentId));
  if (idx === -1) { console.error('Tournament not found in localStorage:', tournamentId); return; }
  const tournament = tournaments[idx];
  // Deep copy bracket to avoid mutation issues
  tournament.bracket = JSON.parse(JSON.stringify(tournament.bracket));
  const bracket = tournament.bracket;
  if (!bracket || !bracket[roundIndex] || !bracket[roundIndex][matchIndex]) return;
  const match = bracket[roundIndex][matchIndex];
  // Delete chat messages for this match since it is now over
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
    // Write directly to Supabase for instant persistence
    if (supabaseClient) {
      await supabaseClient.from('tournaments').update(patchBody).eq('id', tournamentId);
    }
    // Also sync to backend
    const patchRes = await fetch(`${API_BASE_URL}/api/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    const patchData = await patchRes.json();
    if (!patchData.ok) {
      console.error('Backend failed to save match result:', patchData);
    }
  } catch (err) {
    console.error('Failed to persist match result to backend:', err);
    alert('Warning: could not reach backend. Match result may not have saved.');
  }
}



// ── EMOJI AVATARS ─────────────────────────────────────────────────────────────
const AVATARS = [
  { id: 'wolf',     label: 'Wolf',     emoji: '🐺' },
  { id: 'lion',     label: 'Lion',     emoji: '🦁' },
  { id: 'eagle',    label: 'Eagle',    emoji: '🦅' },
  { id: 'shark',    label: 'Shark',    emoji: '🦈' },
  { id: 'tiger',    label: 'Tiger',    emoji: '🐯' },
  { id: 'dragon',   label: 'Dragon',   emoji: '🐉' },
  { id: 'bear',     label: 'Bear',     emoji: '🐻' },
  { id: 'gorilla',  label: 'Gorilla',  emoji: '🦍' },
  { id: 'cobra',    label: 'Cobra',    emoji: '🐍' },
  { id: 'scorpion', label: 'Scorpion', emoji: '🦂' },
  { id: 'skull',    label: 'Skull',    emoji: '💀' },
  { id: 'flame',    label: 'Flame',    emoji: '🔥' },
  { id: 'crown',    label: 'Crown',    emoji: '👑' },
  { id: 'sword',    label: 'Sword',    emoji: '⚔️' },
  { id: 'shield',   label: 'Shield',   emoji: '🛡️' },
  { id: 'diamond',  label: 'Diamond',  emoji: '💎' },
  { id: 'trophy',   label: 'Trophy',   emoji: '🏆' },
  { id: 'stick',    label: 'Stick',    emoji: '🏒' },
  { id: 'thunder',  label: 'Thunder',  emoji: '⚡' },
  { id: 'demon',    label: 'Demon',    emoji: '😈' },
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
  { id: 'undefeated',       icon: '⚡', label: 'Back-to-Back Champ', desc: 'Won 2 consecutive tournaments' },
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

  const seenChampTournaments = new Set();
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

    if (t.status === 'completed' && t.winner === teamName && !seenChampTournaments.has(t.id)) {
      seenChampTournaments.add(t.id);
      champCount++;
      earned.add('champion');
      if (lastTournamentWon) {
        consecutiveTournamentWins++;
        if (consecutiveTournamentWins >= 1) {
          earned.add('back_to_back');
          earned.add('undefeated'); // back-to-back = won 2 tournaments in a row
        }
      } else {
        consecutiveTournamentWins = 0;
      }
      lastTournamentWon = true;
    } else {
      lastTournamentWon = false;
      consecutiveTournamentWins = 0;
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

  // Stats — prefer Supabase match_history for accuracy, fall back to local brackets
  let wins = 0, losses = 0, championships = 0, entered = 0;

  if (supabaseClient) {
    try {
      // Pull all matches this team was in from Supabase
      const { data: histRows } = await supabaseClient
        .from('match_history')
        .select('winner, team1, team2, tournament_id, tournament_name')
        .or('team1.eq.' + team.name + ',team2.eq.' + team.name);

      if (histRows && histRows.length > 0) {
        const seenTournaments = new Set();
        histRows.forEach(function(m) {
          // Skip admin-edit rows — these are manual leaderboard adjustments, not real matches
          if (m.tournament_name === 'Admin Edit' || m.tournament_id === 'admin-edit') return;
          if (m.team2 === 'Admin Edit' || m.team1 === 'Admin Edit') return;
          if (m.team1 === team.name || m.team2 === team.name) {
            seenTournaments.add(m.tournament_id);
            if (m.winner === team.name) wins++;
            else if (m.winner) losses++;
          }
        });
        entered = seenTournaments.size;
      } else {
        // Fallback to local brackets
        tournaments.forEach(t => {
          if (!t.bracket) return;
          let inThisTournament = false;
          t.bracket.forEach(round => round.forEach(m => {
            if (m.team1 === team.name || m.team2 === team.name) inThisTournament = true;
            if (!m.winner) return;
            if (m.team1 === team.name || m.team2 === team.name) {
              if (m.winner === team.name) wins++; else losses++;
            }
          }));
          if (inThisTournament) entered++;
        });
      }
    } catch(e) {
      // Fallback to local
      tournaments.forEach(t => {
        if (!t.bracket) return;
        let inThisTournament = false;
        t.bracket.forEach(round => round.forEach(m => {
          if (m.team1 === team.name || m.team2 === team.name) inThisTournament = true;
          if (!m.winner) return;
          if (m.team1 === team.name || m.team2 === team.name) {
            if (m.winner === team.name) wins++; else losses++;
          }
        }));
        if (inThisTournament) entered++;
      });
    }
  } else {
    tournaments.forEach(t => {
      if (!t.bracket) return;
      let inThisTournament = false;
      t.bracket.forEach(round => round.forEach(m => {
        if (m.team1 === team.name || m.team2 === team.name) inThisTournament = true;
        if (!m.winner) return;
        if (m.team1 === team.name || m.team2 === team.name) {
          if (m.winner === team.name) wins++; else losses++;
        }
      }));
      if (inThisTournament) entered++;
    });
  }

  // Championships — use Supabase as source of truth, deduplicated bracket scan as fallback
  if (supabaseClient) {
    try {
      const { data: champData } = await supabaseClient
        .from('tournaments')
        .select('id')
        .eq('winner', team.name)
        .eq('status', 'completed');
      if (champData) championships = champData.length;
    } catch(e) {
      // Fallback: scan bracket but deduplicate by tournament ID
      const champIds = new Set();
      tournaments.forEach(t => {
        if (t.status === 'completed' && t.winner === team.name && t.id) {
          champIds.add(t.id);
        }
      });
      championships = champIds.size;
    }
  } else {
    // No Supabase — deduplicate by tournament ID
    const champIds = new Set();
    tournaments.forEach(t => {
      if (t.status === 'completed' && t.winner === team.name && t.id) {
        champIds.add(t.id);
      }
    });
    championships = champIds.size;
  }

  const winPct = wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : 0;

  // Goals for / goals against — from approved score_submissions
  let goalsFor = 0, goalsAgainst = 0;
  if (supabaseClient) {
    try {
      const { data: scoreSubs } = await supabaseClient
        .from('score_submissions')
        .select('tournament_id, round_index, match_index, admin_score_t1, admin_score_t2, admin_winner, status')
        .eq('status', 'approved');
      if (scoreSubs) {
        scoreSubs.forEach(function(sub) {
          if (sub.admin_score_t1 == null || sub.admin_score_t2 == null) return;
          const t = tournaments.find(t => String(t.id) === String(sub.tournament_id));
          if (!t || !t.bracket) return;
          const round = t.bracket[sub.round_index];
          if (!round) return;
          const match = round[sub.match_index];
          if (!match) return;
          if (match.team1 === team.name) {
            goalsFor += sub.admin_score_t1;
            goalsAgainst += sub.admin_score_t2;
          } else if (match.team2 === team.name) {
            goalsFor += sub.admin_score_t2;
            goalsAgainst += sub.admin_score_t1;
          }
        });
      }
    } catch(e) { /* ignore */ }
  }

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

  // Stats card — hockey card style
  const statsCard = document.createElement('div');
  statsCard.className = 'team-stats-card container';

  // Win rate ring + headline stat
  const statsHero = document.createElement('div');
  statsHero.className = 'stats-hero';
  const winRateVal = wins + losses > 0 ? winPct : 0;
  const ringCircumference = 2 * Math.PI * 44; // r=44
  const ringOffset = ringCircumference * (1 - winRateVal / 100);
  statsHero.innerHTML = `
    <div class="win-rate-ring">
      <svg viewBox="0 0 100 100" class="ring-svg">
        <circle cx="50" cy="50" r="44" class="ring-track"/>
        <circle cx="50" cy="50" r="44" class="ring-fill"
          stroke-dasharray="${ringCircumference.toFixed(1)}"
          stroke-dashoffset="${ringOffset.toFixed(1)}"
          transform="rotate(-90 50 50)"/>
      </svg>
      <div class="ring-label">
        <span class="ring-pct">${winRateVal}%</span>
        <span class="ring-sub">Win Rate</span>
      </div>
    </div>
    <div class="stats-grid stats-grid--6">
      <div class="stat-box ${championships > 0 ? 'stat-box--champ' : ''}">
        <span class="stat-box-val">${championships}</span>
        <span class="stat-box-label">${championships === 1 ? 'Championship' : 'Championships'}</span>
      </div>
      <div class="stat-box">
        <span class="stat-box-val">${wins}</span>
        <span class="stat-box-label">Wins</span>
      </div>
      <div class="stat-box">
        <span class="stat-box-val">${losses}</span>
        <span class="stat-box-label">Losses</span>
      </div>
      <div class="stat-box">
        <span class="stat-box-val">${goalsFor}</span>
        <span class="stat-box-label">Goals For</span>
      </div>
      <div class="stat-box">
        <span class="stat-box-val">${goalsAgainst}</span>
        <span class="stat-box-label">Goals Against</span>
      </div>
      <div class="stat-box">
        <span class="stat-box-val">${entered}</span>
        <span class="stat-box-label">Tournaments</span>
      </div>
    </div>
  `;
  statsCard.appendChild(statsHero);
  container.appendChild(statsCard);

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

  // ── Tab bar ──────────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.className = 'profile-tab-bar';
  tabBar.style.cssText = 'display:flex;gap:0;border-bottom:2px solid var(--gold);margin-bottom:1.75rem;';

  const tabs = [
    { id: 'tab-profile', label: 'My Profile' },
    { id: 'tab-team',    label: 'My Team' },
  ];

  tabs.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = t.id;
    btn.textContent = t.label;
    btn.style.cssText = 'background:none;border:none;padding:0.65rem 1.5rem;font-family:Barlow Condensed,sans-serif;font-size:1rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:color 0.15s,border-color 0.15s;color:var(--text-muted);';
    if (i === 0) {
      btn.style.color = 'var(--gold)';
      btn.style.borderBottomColor = 'var(--gold)';
    }
    btn.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab-btn').forEach(b => {
        b.style.color = 'var(--text-muted)';
        b.style.borderBottomColor = 'transparent';
      });
      btn.style.color = 'var(--gold)';
      btn.style.borderBottomColor = 'var(--gold)';
      document.querySelectorAll('.profile-tab-pane').forEach(p => p.style.display = 'none');
      document.getElementById('pane-' + t.id.replace('tab-', '')).style.display = 'block';
    });
    btn.className = 'profile-tab-btn';
    tabBar.appendChild(btn);
  });
  main.appendChild(tabBar);

  // ── Profile pane ─────────────────────────────────────────────────────────
  const profilePane = document.createElement('div');
  profilePane.id = 'pane-profile';
  profilePane.className = 'profile-tab-pane';
  profilePane.style.display = 'block';

  // Banner preview
  const preview = document.createElement('div');
  preview.id = 'banner-preview';
  preview.className = 'banner-preview';
  preview.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #0a0a0a 100%)';
  const previewAvatar = document.createElement('div');
  previewAvatar.id = 'preview-avatar';
  previewAvatar.innerHTML = renderAvatarSVG('wolf', 64);
  preview.appendChild(previewAvatar);
  profilePane.appendChild(preview);

  const form = document.createElement('form');
  form.id = 'profile-form';
  form.className = 'auth-form profile-editor-form';

  // Basic info
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
  const colorInput = document.createElement('input');
  colorInput.type = 'hidden';
  colorInput.id = 'profile-banner-color';
  colorInput.value = '#1a1a2e';
  colorRow.appendChild(colorInput);
  bannerSection.appendChild(colorRow);
  form.appendChild(bannerSection);

  // Avatar color
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

  profilePane.appendChild(form);
  main.appendChild(profilePane);

  // ── My Team pane ──────────────────────────────────────────────────────────
  const teamPane = document.createElement('div');
  teamPane.id = 'pane-team';
  teamPane.className = 'profile-tab-pane';
  teamPane.style.display = 'none';

  buildTeamPane(teamPane);
  main.appendChild(teamPane);
}

// ── Build the My Team pane content ────────────────────────────────────────────
function buildTeamPane(container) {
  container.innerHTML = '';
  const currentEmail = getCurrentUser();

  if (!currentEmail) {
    const msg = document.createElement('p');
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Please log in to manage your team.';
    container.appendChild(msg);
    return;
  }

  const team = getUserTeam();

  if (!team) {
    // ── No team yet — show create form ──────────────────────────────────────
    const heading = document.createElement('h2');
    heading.textContent = 'Create Your Team';
    heading.style.marginBottom = '0.25rem';
    container.appendChild(heading);

    const sub = document.createElement('p');
    sub.style.cssText = 'color:var(--text-muted);margin-bottom:1.5rem;font-size:0.95rem;';
    sub.textContent = 'Create a team to register for tournaments. You can only be on one team at a time.';
    container.appendChild(sub);

    const card = document.createElement('div');
    card.className = 'rule-card';
    card.style.maxWidth = '480px';

    const nameLabel = document.createElement('label');
    nameLabel.style.cssText = 'display:block;font-weight:700;margin-bottom:0.5rem;font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.05em;font-size:0.9rem;color:var(--text-muted);';
    nameLabel.textContent = 'Team Name';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'e.g. Tim Packs HC';
    nameInput.style.cssText = 'width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);color:var(--text);font-size:1rem;margin-bottom:1rem;box-sizing:border-box;';

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'button';
    createBtn.style.cssText = 'width:100%;';
    createBtn.textContent = 'Create Team';

    createBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
      const result = createTeam(name);
      if (result) {
        if (typeof syncTeamsFromBackend === 'function') {
          await syncTeamsFromBackend().catch(() => {});
        }
        buildTeamPane(container);
      } else {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Team';
      }
    });

    card.appendChild(nameLabel);
    card.appendChild(nameInput);
    card.appendChild(createBtn);
    container.appendChild(card);

  } else {
    // ── Has a team — show team details ──────────────────────────────────────
    const isCaptain = team.captain === currentEmail;

    const heading = document.createElement('h2');
    heading.style.marginBottom = '0.25rem';
    heading.textContent = team.name;
    container.appendChild(heading);

    const role = document.createElement('p');
    role.style.cssText = 'color:var(--gold);font-family:Barlow Condensed,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;font-size:0.85rem;margin-bottom:1.5rem;';
    role.textContent = isCaptain ? '⭐ Captain' : 'Member';
    container.appendChild(role);

    // View team page button
    const viewBtn = document.createElement('a');
    viewBtn.className = 'button';
    viewBtn.style.cssText = 'display:inline-block;text-decoration:none;margin-bottom:1.5rem;font-size:0.85rem;padding:0.5rem 1rem;';
    viewBtn.textContent = '👁 View Team Page';
    viewBtn.href = `team.html?id=${team.id}`;
    container.appendChild(viewBtn);

    // Members card
    const membersCard = document.createElement('div');
    membersCard.className = 'rule-card';
    membersCard.style.maxWidth = '480px';

    const membersTitle = document.createElement('h3');
    membersTitle.style.cssText = 'margin:0 0 0.75rem;font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.05em;font-size:1rem;';
    membersTitle.textContent = 'Members';
    membersCard.appendChild(membersTitle);

    const membersList = document.createElement('ul');
    membersList.style.cssText = 'list-style:none;padding:0;margin:0 0 1rem;';
    (team.members || []).forEach(m => {
      const li = document.createElement('li');
      li.style.cssText = 'padding:0.35rem 0;border-bottom:1px solid var(--border);font-size:0.95rem;';
      li.textContent = m + (m === team.captain ? ' ⭐' : '');
      membersList.appendChild(li);
    });
    membersCard.appendChild(membersList);



    container.appendChild(membersCard);
  }
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
        // If it is a bucket/permissions issue, warn but continue — save record with null URL
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
    // Fire Discord webhook via backend (server-side, works for all users)
    try {
      var _ts = loadTournaments().find(function(x) { return String(x.id) === String(tournamentId); });
      var _tName = (_ts && _ts.name) ? _ts.name : String(tournamentId);
      fetch(API_BASE_URL + '/api/notify/submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentName: _tName, reportedWinner: reportedWinner, submitterEmail: submitterEmail }),
      }).catch(function(e) { console.warn('[Webhook] Submission notify failed:', e.message); });
    } catch(e) { console.warn('[Webhook] Score submission notify error:', e); }
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

// ── ADMIN: MATCH HISTORY EDITOR ──────────────────────────────────────────────

async function renderAdminMatchHistory() {
  const container = document.getElementById('admin-history-container');
  if (!container || !supabaseClient) return;
  container.innerHTML = '<p style="color:var(--text-muted)">Loading match history...</p>';

  try {
    const { data, error } = await supabaseClient
      .from('match_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      container.innerHTML = '<p style="color:#ff6b6b">Error: ' + error.message + '</p>';
      return;
    }
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted)">No match history yet.</p>';
      return;
    }

    container.innerHTML = '';

    // Search/filter bar
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'margin-bottom:1rem;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter by team name or tournament...';
    searchInput.style.cssText = 'flex:1;min-width:200px;padding:0.5rem 0.75rem;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.9rem;';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'button delete';
    clearBtn.textContent = 'Clear Filter';
    clearBtn.style.cssText = 'font-size:0.8rem;padding:0.4rem 0.75rem;';
    clearBtn.addEventListener('click', function() { searchInput.value = ''; renderRows(data); });
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(clearBtn);
    container.appendChild(searchWrap);

    const tableWrap = document.createElement('div');
    container.appendChild(tableWrap);

    function renderRows(rows) {
      tableWrap.innerHTML = '';
      if (rows.length === 0) {
        tableWrap.innerHTML = '<p style="color:var(--text-muted)">No results.</p>';
        return;
      }

      const header = document.createElement('div');
      header.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto auto;gap:0.5rem;padding:0.5rem 0.75rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);border-bottom:1px solid var(--border);margin-bottom:0.25rem;';
      header.innerHTML = '<span>Tournament</span><span>Team 1</span><span>Team 2</span><span>Winner</span><span></span>';
      tableWrap.appendChild(header);

      rows.forEach(function(row) {
        const el = document.createElement('div');
        el.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto auto;gap:0.5rem;align-items:center;padding:0.6rem 0.75rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:0.3rem;font-size:0.85rem;';

        const tName = document.createElement('span');
        tName.style.cssText = 'color:var(--text-muted);font-size:0.78rem;';
        tName.textContent = row.tournament_name || '—';

        const t1 = document.createElement('span');
        t1.textContent = row.team1;
        t1.style.color = row.winner === row.team1 ? 'var(--gold)' : 'var(--text)';

        const t2 = document.createElement('span');
        t2.textContent = row.team2;
        t2.style.color = row.winner === row.team2 ? 'var(--gold)' : 'var(--text)';

        const winner = document.createElement('span');
        winner.style.cssText = 'font-weight:600;color:var(--gold);font-size:0.8rem;white-space:nowrap;';
        winner.textContent = '✓ ' + (row.winner || '?');

        const delBtn = document.createElement('button');
        delBtn.className = 'button delete';
        delBtn.textContent = 'Delete';
        delBtn.style.cssText = 'font-size:0.72rem;padding:0.25rem 0.6rem;white-space:nowrap;';
        delBtn.addEventListener('click', async function() {
          if (!confirm('Delete this match result? ' + row.team1 + ' vs ' + row.team2 + ' — Winner: ' + row.winner + '. This will remove it from leaderboard stats.')) return;
          delBtn.disabled = true;
          delBtn.textContent = '...';
          const { error: delErr } = await supabaseClient.from('match_history').delete().eq('id', row.id);
          if (delErr) {
            alert('Delete failed: ' + delErr.message);
            delBtn.disabled = false;
            delBtn.textContent = 'Delete';
          } else {
            el.style.opacity = '0.3';
            el.style.pointerEvents = 'none';
            delBtn.textContent = 'Deleted';
          }
        });

        el.appendChild(tName);
        el.appendChild(t1);
        el.appendChild(t2);
        el.appendChild(winner);
        el.appendChild(delBtn);
        tableWrap.appendChild(el);
      });
    }

    searchInput.addEventListener('input', function() {
      const q = searchInput.value.toLowerCase();
      if (!q) { renderRows(data); return; }
      const filtered = data.filter(function(r) {
        return (r.team1 && r.team1.toLowerCase().includes(q)) ||
               (r.team2 && r.team2.toLowerCase().includes(q)) ||
               (r.tournament_name && r.tournament_name.toLowerCase().includes(q)) ||
               (r.winner && r.winner.toLowerCase().includes(q));
      });
      renderRows(filtered);
    });

    renderRows(data);

  } catch(e) {
    container.innerHTML = '<p style="color:#ff6b6b">Failed to load: ' + e.message + '</p>';
  }
}

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
    // Filter out admin-edit adjustment rows — these are leaderboard corrections, not real matches
    return (data || []).filter(function(m) {
      return m.tournament_name !== 'Admin Edit'
        && m.tournament_id !== 'admin-edit'
        && m.team1 !== 'Admin Edit'
        && m.team2 !== 'Admin Edit';
    });
  } catch(e) { return []; }
}

// ── PHASE 5: TOURNAMENT PASSWORD ─────────────────────────────────────────────
// Password is stored as tournament.password in the bracket object
// When joining, user must enter matching password

function checkTournamentPassword(tournament, enteredPassword) {
  if (!tournament.password) return true; // no password set = open
  return tournament.password === enteredPassword;
}

// ── PHASE 6: DISCORD WEBHOOKS ────────────────────────────────────────────────

// WEBHOOK_KEYS defined at top of file (var, so hoisted):
// webhook_results, webhook_champions, webhook_submissions, webhook_registrations

// Core send function — all webhooks go through here
async function sendToWebhook(type, embeds) {
  var key = WEBHOOK_KEYS[type];
  if (!key) { console.warn('[Webhook] Unknown type:', type); return; }
  var url = localStorage.getItem(key);
  if (!url) { console.warn('[Webhook] No URL for type:', type); return; }
  // Discord deprecated discordapp.com — rewrite silently
  url = url.replace('discordapp.com', 'discord.com');
  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: embeds }),
    });
    if (res.ok) {
      console.log('[Webhook] ' + type + ' sent OK (' + res.status + ')');
    } else {
      console.error('[Webhook] ' + type + ' failed: HTTP ' + res.status);
    }
  } catch(e) {
    console.error('[Webhook] ' + type + ' fetch error:', e.message);
  }
}

// 1. Match result → #score-results
function announceMatchResult(tournamentName, team1, team2, winner, score1, score2) {
  var loser = (team1 === winner) ? team2 : team1;
  var hasScores = (score1 != null && score2 != null && !isNaN(score1) && !isNaN(score2));
  var desc = '**' + winner + '** defeated **' + loser + '**';
  if (hasScores) desc += '\n📊 **' + team1 + '** ' + score1 + ' – ' + score2 + ' **' + team2 + '**';
  sendToWebhook('results', [{
    title: '🏒 Match Result',
    description: desc,
    color: 0xffc72c,
    fields: [{ name: 'Tournament', value: tournamentName || 'Unknown', inline: true }],
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
}

// 2. Tournament champion → #champions
function announceTournamentComplete(tournamentName, winner) {
  sendToWebhook('champions', [{
    title: '🏆 ' + winner + ' are the Champions!',
    description: '**' + winner + '** are the champions of **' + tournamentName + '**!\n\n🎉 Congratulations! 👑',
    color: 0xffd700,
    thumbnail: { url: 'https://www.reggysosa.com/logo.png' },
    footer: { text: 'Reggy Sosa Tournaments • ' + new Date().toLocaleDateString() },
    timestamp: new Date().toISOString(),
  }]);
}

// 3. Score photo submitted → #score-submissions
function announceScoreSubmission(tournamentName, reportedWinner, submitterEmail) {
  sendToWebhook('submissions', [{
    title: '📸 Score Submission — Review Needed',
    description: 'A player submitted a score screenshot waiting for admin review.\n\nGo to **Admin \u2192 Score Queue** to approve.',
    color: 0xff9500,
    fields: [
      { name: 'Tournament', value: tournamentName || 'Unknown', inline: true },
      { name: 'Reported Winner', value: reportedWinner || 'Unknown', inline: true },
      { name: 'Submitted by', value: submitterEmail || 'Unknown', inline: false },
    ],
    footer: { text: 'reggysosa.com/admin.html' },
    timestamp: new Date().toISOString(),
  }]);
}

// 4. Team registered → #registrations
function announceTournamentCreated(tournamentName, startDate, maxTeams, goalieRequired, entryFee, startTime) {
  var dateStr = 'TBD';
  if (startDate) {
    var parts = startDate.split('-');
    var localDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    dateStr = localDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (startTime) {
      var timeParts = startTime.split(':');
      var h = parseInt(timeParts[0]);
      var m = timeParts[1];
      var ampm = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12 || 12;
      dateStr += ' at ' + h12 + ':' + m + ' ' + ampm + ' ET';
    }
  }
  var feeVal = parseFloat(entryFee) || 0;
  var feeStr = feeVal > 0 ? '💰 $' + feeVal.toFixed(2) + ' per team' : '🆓 Free Entry';
  var pct = getPrizePoolPct();
  var maxPrizePool = feeVal > 0 ? '$' + (Math.round(feeVal * maxTeams * (pct / 100) * 100) / 100).toFixed(2) + ' (' + pct + '% of total entry fees)' : 'N/A';
  var fields = [
    { name: 'Tournament',      value: tournamentName || 'Unknown',                                        inline: false },
    { name: 'Start Date & Time', value: dateStr,                                                          inline: true  },
    { name: 'Max Teams',       value: String(maxTeams || '?'),                                            inline: true  },
    { name: 'Entry Fee',       value: feeStr,                                                             inline: true  },
    { name: '🏆 Prize Pool',   value: maxPrizePool,                                                      inline: true  },
    { name: 'Goalie Required', value: goalieRequired ? '✅ Yes — a goalie is required' : '❌ No',         inline: false },
  ];
  sendToWebhook('created', [{
    title: '🏆 New Tournament — Registration Open!',
    description: 'A new tournament has been created. Sign up now before spots fill up!',
    color: 0xffc72c,
    fields: fields,
    footer: { text: 'Head to reggysosa.com/tournaments.html to register' },
    timestamp: new Date().toISOString(),
  }]);
}

function announceRegistrationUpdate(tournament) {
  var name = tournament.name || 'Unknown Tournament';
  var teams = tournament.teams ? tournament.teams.length : 0;
  var max = tournament.maxTeams || tournament.max_teams || null;
  var spotsLeft = max ? max - teams : null;
  var spotsStr = spotsLeft !== null ? String(spotsLeft) + ' spot' + (spotsLeft !== 1 ? 's' : '') + ' left' : 'Open';
  var statusStr = spotsLeft === 0 ? 'Full — Registration Closed' : 'Open';

  // Format start date + time in ET
  var dateStr = 'TBD';
  if (tournament.startDate || tournament.start_date) {
    var raw = tournament.startDate || tournament.start_date;
    var parts = raw.split('-');
    var localDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    dateStr = localDate.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    var st = tournament.startTime || tournament.start_time;
    if (st) {
      var tp = st.split(':');
      var hh = parseInt(tp[0]);
      var mm = tp[1];
      var ap = hh >= 12 ? 'PM' : 'AM';
      var h12 = hh % 12 || 12;
      dateStr += ' at ' + h12 + ':' + mm + ' ' + ap + ' ET';
    }
  }

  // Entry fee
  var feeVal = parseFloat(tournament.entry_fee || tournament.entryFee) || 0;
  var feeStr = feeVal > 0 ? '💰 $' + feeVal.toFixed(2) + ' per team' : '🆓 Free Entry';

  // Prize pool — show max potential (full tournament)
  var pct = getPrizePoolPct();
  var maxTeamsCount = max || teams;
  var prizePool = feeVal > 0 ? '$' + (Math.round(feeVal * maxTeamsCount * (pct / 100) * 100) / 100).toFixed(2) + ' (' + pct + '% of total entry fees)' : 'N/A';

  // Goalie required
  var goalieStr = tournament.goalieRequired || tournament.goalie_required ? '✅ Yes — a goalie is required' : '❌ No';

  // Current time in EST for the footer
  var estTime = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  }) + ' EST';

  sendToWebhook('created', [{
    title: '🏒 Registration Update — ' + name,
    description: spotsLeft === 0
      ? '❌ This tournament is now **full**. Registration is closed.'
      : '📣 Spots are still available — register now before it fills up!',
    color: spotsLeft === 0 ? 0xff4e1a : 0xffc72c,
    fields: [
      { name: 'Tournament',      value: name,                                      inline: false },
      { name: 'Teams Signed Up', value: String(teams) + (max ? ' / ' + max : ''), inline: true  },
      { name: 'Spots Left',      value: spotsStr,                                  inline: true  },
      { name: 'Entry Fee',       value: feeStr,                                    inline: true  },
      { name: '🏆 Prize Pool',   value: prizePool,                                 inline: true  },
      { name: 'Start Date',      value: dateStr,                                   inline: false },
      { name: 'Goalie Required', value: goalieStr,                                 inline: true  },
      { name: 'Status',          value: statusStr,                                 inline: true  },
    ],
    footer: { text: 'reggysosa.com/tournaments.html • Posted ' + estTime },
    timestamp: new Date().toISOString(),
  }]);
}

function announceTeamRegistration(teamName, tournamentName, totalTeams, maxTeams, entryFee) {
  var feeVal = parseFloat(entryFee) || 0;
  var fields = [
    { name: 'Tournament',   value: tournamentName || 'Unknown',                          inline: true },
    { name: 'Spots Filled', value: (totalTeams || '?') + ' / ' + (maxTeams || '∞'),     inline: true },
    { name: 'Entry Fee',    value: feeVal > 0 ? '💰 $' + feeVal.toFixed(2) : '🆓 Free', inline: true },
  ];
  // Add prize pool if applicable
  if (feeVal > 0) {
    var pct = getPrizePoolPct();
    var pool = Math.round(feeVal * (totalTeams || 1) * (pct / 100) * 100) / 100;
    fields.push({ name: '🏆 Current Prize Pool', value: '$' + pool.toFixed(2), inline: false });
  }
  sendToWebhook('registrations', [{
    title: '👥 New Team Registered',
    description: '**' + teamName + '** has entered **' + tournamentName + '**!',
    color: 0x00c9a7,
    fields: fields,
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
}

// 5. Bracket posted → #score-results (no match codes)
function announceBracketGenerated(tournamentName, bracket) {
  if (!bracket || !Array.isArray(bracket) || !bracket[0]) return;
  var lines = bracket[0]
    .filter(function(m) { return m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE'; })
    .map(function(m) { return '⚔️ **' + m.team1 + '** vs **' + m.team2 + '**'; })
    .join('\n');
  sendToWebhook('results', [{
    title: '🏒 Bracket Set — ' + tournamentName,
    description: 'Round 1 matchups:\n\n' + (lines || 'TBD') + '\n\nHead to **reggysosa.com** to find your match!',
    color: 0xffc72c,
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
}

// Load saved URLs into admin settings inputs
function loadWebhookSettings() {
  Object.entries(WEBHOOK_KEYS).forEach(function(entry) {
    var type = entry[0], key = entry[1];
    var input = document.getElementById('webhook-input-' + type);
    if (!input) return;
    input.value = localStorage.getItem(key) || '';
    // Mark as touched when user manually edits the field
    input.addEventListener('input', function() { input.dataset.touched = '1'; }, { once: false });
  });
}

// Save all 4 URLs from admin settings inputs
function saveAllWebhooks() {
  // Collect all 4 URLs from inputs
  var urls = {};
  Object.entries(WEBHOOK_KEYS).forEach(function(entry) {
    var type = entry[0], key = entry[1];
    var input = document.getElementById('webhook-input-' + type);
    if (!input) return;
    var url = input.value.trim();
    if (url) {
      localStorage.setItem(key, url);
      urls[key] = url;
    }
    // Never delete existing keys if input is blank — user must explicitly clear
  });

  // Also push to Supabase so ALL user browsers can fetch them on page load
  if (supabaseClient && Object.keys(urls).length > 0) {
    var payload = JSON.stringify(urls);
    supabaseClient.from('profiles')
      .update({ webhook_urls: payload })
      .eq('email', ADMIN_EMAIL)
      .then(function(res) {
        if (res.error) {
          // webhook_urls column may not exist yet — that's OK, localStorage still works
          console.warn('[Webhook] Could not save to Supabase (column may need adding):', res.error.message);
        } else {
          console.log('[Webhook] URLs saved to Supabase for all users');
        }
      });
  }

  var status = document.getElementById('webhook-status');
  if (status) {
    status.textContent = '✅ All webhooks saved!';
    status.style.display = 'block';
    setTimeout(function() { status.style.display = 'none'; }, 2500);
  }
}

// Fetch webhook URLs from Supabase admin profile and populate localStorage
// Called on every page load so all users have the URLs
async function fetchAndCacheWebhookUrls() {
  if (!supabaseClient) return;
  try {
    var res = await supabaseClient.from('profiles')
      .select('webhook_urls')
      .eq('email', ADMIN_EMAIL)
      .single();
    if (res.data && res.data.webhook_urls) {
      var urls = JSON.parse(res.data.webhook_urls);
      Object.entries(urls).forEach(function(entry) {
        var key = entry[0], url = entry[1];
        if (url) localStorage.setItem(key, url);
      });
      console.log('[Webhook] URLs loaded from Supabase into localStorage');
    }
  } catch(e) {
    // Column doesn't exist yet or network error — silently ignore, localStorage fallback still works
    console.warn('[Webhook] Could not fetch URLs from Supabase:', e.message);
  }
}

// Test a specific webhook from admin settings
async function testWebhook(type) {
  var key = WEBHOOK_KEYS[type];
  if (!key) { alert('Unknown webhook type: ' + type); return; }
  var url = localStorage.getItem(key);
  if (!url) { alert('No URL saved for "' + type + '". Save it first.'); return; }
  await sendToWebhook(type, [{
    title: '✅ Test — ' + type,
    description: 'The **' + type + '** webhook is connected and working!',
    color: 0xffc72c,
    footer: { text: 'Reggy Sosa Tournaments' },
    timestamp: new Date().toISOString(),
  }]);
  alert('Test sent! Check your Discord channel.');
}

// Migrate legacy single-URL to results slot on page load
(function() {
  var legacy = localStorage.getItem('discordWebhookUrl') || localStorage.getItem('discord_webhook_url');
  if (legacy && !localStorage.getItem(WEBHOOK_KEYS.results)) {
    localStorage.setItem(WEBHOOK_KEYS.results, legacy);
    console.log('[Webhook] Migrated legacy URL to webhook_results');
  }
})();

// ── Leaderboard ──────────────────────────────────────────────────────────────

async function buildLeaderboardData() {
  // Data already synced on page load — no need to re-sync here
  // This was causing slow/stuck loading on mobile

  const tournaments = loadTournaments();
  const teams = loadTeams();

  // Map: teamName -> stats
  const stats = {};

  // Build team name -> id map for profile links
  const teamIdMap = {};
  teams.forEach(function(t) { if (t.name) teamIdMap[t.name] = t.id; });

  function getOrCreate(name) {
    if (!stats[name]) {
      stats[name] = {
        name,
        teamId: teamIdMap[name] || null,
        championships: 0,
        wins: 0,
        losses: 0,
        tournamentsEntered: 0,
        tournamentIds: new Set(),
      };
    }
    return stats[name];
  }

  // Count tournament entries and championships from local bracket data
  for (const t of tournaments) {
    if (!t.bracket || !Array.isArray(t.bracket)) continue;
    const enteredTeams = new Set();
    t.bracket.forEach(round => {
      round.forEach(match => {
        if (match.team1 && match.team1 !== 'BYE' && match.team1 !== 'TBD') enteredTeams.add(match.team1);
        if (match.team2 && match.team2 !== 'BYE' && match.team2 !== 'TBD') enteredTeams.add(match.team2);
      });
    });
    enteredTeams.forEach(name => {
      const s = getOrCreate(name);
      if (!s.tournamentIds.has(t.id)) {
        s.tournamentIds.add(t.id);
        s.tournamentsEntered++;
      }
    });
    if (t.status === 'completed' && t.winner && t.winner !== 'TBD' && t.winner !== 'Admin Edit') {
      getOrCreate(t.winner).championships++;
    }
  }

  // Step 1: Count wins/losses from tournament brackets (real match results)
  const SKIP = new Set(['BYE', 'TBD', 'Admin Edit', '']);
  for (const t of tournaments) {
    if (!t.bracket || !Array.isArray(t.bracket)) continue;
    t.bracket.forEach(round => {
      round.forEach(match => {
        if (!match.winner || !match.team1 || !match.team2) return;
        if (SKIP.has(match.team1) || SKIP.has(match.team2) || SKIP.has(match.winner)) return;
        getOrCreate(match.winner).wins++;
        const loser = match.team1 === match.winner ? match.team2 : match.team1;
        if (!SKIP.has(loser)) getOrCreate(loser).losses++;
      });
    });
  }

  // Step 2: Apply admin manual adjustments from match_history (only admin-edit rows)
  // These are rows inserted by the leaderboard editor with tournament_name='Admin Edit'
  if (supabaseClient) {
    try {
      const { data: adminEdits } = await supabaseClient
        .from('match_history')
        .select('team1, team2, winner')
        .eq('tournament_name', 'Admin Edit');
      if (adminEdits && adminEdits.length > 0) {
        adminEdits.forEach(function(m) {
          if (!m.team1 || !m.team2 || !m.winner) return;
          if (m.winner && m.winner !== 'Admin Edit' && m.winner !== 'TBD') getOrCreate(m.winner).wins++;
          const loser = m.winner === m.team1 ? m.team2 : m.team1;
          if (loser && loser !== 'Admin Edit' && loser !== 'TBD' && loser !== 'BYE') getOrCreate(loser).losses++;
        });
      }
    } catch(e) { /* ignore — bracket data already counted above */ }
  }

  // Pull goals for / goals against from approved score_submissions
  if (supabaseClient) {
    try {
      const { data: scoreSubs } = await supabaseClient
        .from('score_submissions')
        .select('reported_winner, admin_score_t1, admin_score_t2, admin_winner')
        .eq('status', 'approved');

      // We need to match scores to teams via the bracket
      // admin_winner tells us who won, admin_score_t1 = team1 goals, admin_score_t2 = team2 goals
      // We need to know which submission maps to which teams
      // Pull full data including round/match indexes and tournament_id
      const { data: fullSubs } = await supabaseClient
        .from('score_submissions')
        .select('tournament_id, round_index, match_index, admin_score_t1, admin_score_t2, admin_winner, status')
        .eq('status', 'approved');

      if (fullSubs) {
        const localTourneys = loadTournaments();
        fullSubs.forEach(sub => {
          if (sub.admin_score_t1 == null || sub.admin_score_t2 == null) return;
          const t = localTourneys.find(t => String(t.id) === String(sub.tournament_id));
          if (!t || !t.bracket) return;
          const round = t.bracket[sub.round_index];
          if (!round) return;
          const match = round[sub.match_index];
          if (!match || !match.team1 || !match.team2) return;
          const t1 = match.team1;
          const t2 = match.team2;
          if (stats[t1]) {
            stats[t1].gf = (stats[t1].gf || 0) + sub.admin_score_t1;
            stats[t1].ga = (stats[t1].ga || 0) + sub.admin_score_t2;
          }
          if (stats[t2]) {
            stats[t2].gf = (stats[t2].gf || 0) + sub.admin_score_t2;
            stats[t2].ga = (stats[t2].ga || 0) + sub.admin_score_t1;
          }
        });
      }
    } catch(e) { /* ignore, GF/GA will just be 0 */ }
  }

  // Convert to array and compute win %
  const SKIP_FINAL = new Set(['BYE', 'TBD', 'Admin Edit', '']);
  return Object.values(stats)
    .filter(s => s.name && !SKIP_FINAL.has(s.name))
    .map(s => ({
      ...s,
      tournamentIds: undefined,
      teamId: s.teamId || null,
      gf: s.gf || 0,
      ga: s.ga || 0,
      gd: (s.gf || 0) - (s.ga || 0),
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
    const isAdmin = getCurrentUserRole() === 'admin';
    const _supa = supabaseClient; // capture in render() scope so closures always have it

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
      { label: 'Most Wins',     key: 'wins' },
      { label: 'Win %',         key: 'winPct' },
      { label: 'Goals For',     key: 'gf' },
      { label: 'Goal Diff',     key: 'gd' },
      { label: 'Tournaments',   key: 'tournamentsEntered' },
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
    colHeader.className = 'leaderboard-row leaderboard-col-header' + (isAdmin ? ' leaderboard-row--admin' : '');
    colHeader.innerHTML =
      '<span class="lb-rank">#</span>' +
      '<span class="lb-team">Team</span>' +
      '<span class="lb-stat">🏆</span>' +
      '<span class="lb-stat">W</span>' +
      '<span class="lb-stat">L</span>' +
      '<span class="lb-stat">W%</span>' +
      '<span class="lb-stat">GF</span>' +
      '<span class="lb-stat">GA</span>' +
      '<span class="lb-stat">GD</span>' +
      '<span class="lb-stat">Played</span>' +
      (isAdmin ? '<span class="lb-stat"></span>' : '');
    table.appendChild(colHeader);

    const rows = sorted(key, dir);
    rows.forEach((team, i) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row' + (i < 3 ? ' top-' + (i + 1) : '');
      if (team.teamId) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function(e) {
          // Don't double-navigate if they clicked the name link directly
          if (e.target.tagName === 'A') return;
          window.location.href = 'team.html?id=' + team.teamId;
        });
      }

      const rankEl = document.createElement('span');
      rankEl.className = 'lb-rank';
      rankEl.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);

      // Make team name clickable — links to team profile page
      const nameEl = team.teamId
        ? document.createElement('a')
        : document.createElement('span');
      nameEl.className = 'lb-team lb-team-link';
      if (team.teamId) {
        nameEl.href = 'team.html?id=' + team.teamId;
        nameEl.title = 'View ' + team.name + '\'s profile';
      }
      const nameText = document.createTextNode(team.name);
      nameEl.appendChild(nameText);
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

      const gfEl = document.createElement('span');
      gfEl.className = 'lb-stat' + (key === 'gf' ? ' highlight' : '');
      gfEl.textContent = team.gf || 0;

      const gaEl = document.createElement('span');
      gaEl.className = 'lb-stat';
      gaEl.textContent = team.ga || 0;

      const gdEl = document.createElement('span');
      gdEl.className = 'lb-stat' + (key === 'gd' ? ' highlight' : '');
      const gdVal = (team.gf || 0) - (team.ga || 0);
      gdEl.textContent = (gdVal > 0 ? '+' : '') + gdVal;
      gdEl.style.color = gdVal > 0 ? 'var(--gold)' : gdVal < 0 ? '#ff6b6b' : 'inherit';

      row.appendChild(rankEl);
      row.appendChild(nameEl);
      row.appendChild(champEl);
      row.appendChild(winsEl);
      row.appendChild(lossEl);
      row.appendChild(pctEl);
      row.appendChild(gfEl);
      row.appendChild(gaEl);
      row.appendChild(gdEl);
      row.appendChild(playedEl);

      // Admin-only three-dot edit button
      if (isAdmin) {
        row.classList.add('leaderboard-row--admin');
        const dotsBtn = document.createElement('button');
        dotsBtn.className = 'lb-edit-btn';
        dotsBtn.textContent = '⋯';
        dotsBtn.title = 'Edit ' + team.name + ' stats';
        dotsBtn.addEventListener('click', function(e) {
          e.stopPropagation(); // don't navigate to team page
          // Toggle edit panel
          const existingPanel = document.getElementById('lb-edit-' + i);
          if (existingPanel) { existingPanel.remove(); return; }
          // Close any other open panels first
          document.querySelectorAll('.lb-edit-panel').forEach(p => p.remove());

          const panel = document.createElement('div');
          panel.className = 'lb-edit-panel';
          panel.id = 'lb-edit-' + i;
          panel.innerHTML =
            '<p class="lb-edit-title">Edit Stats — ' + team.name + '</p>' +
            '<p class="lb-edit-note">Changes update Supabase directly. GF/GA require score submissions to exist — edit those values there.</p>' +
            '<div class="lb-edit-fields">' +
              '<label>Championships<input type="number" min="0" id="lbe-champ-' + i + '" value="' + team.championships + '" /></label>' +
              '<label>Wins<input type="number" min="0" id="lbe-wins-' + i + '" value="' + team.wins + '" /></label>' +
              '<label>Losses<input type="number" min="0" id="lbe-losses-' + i + '" value="' + team.losses + '" /></label>' +
              '<label>GF<input type="number" min="0" id="lbe-gf-' + i + '" value="' + (team.gf || 0) + '" /></label>' +
              '<label>GA<input type="number" min="0" id="lbe-ga-' + i + '" value="' + (team.ga || 0) + '" /></label>' +
            '</div>' +
            '<div class="lb-edit-actions">' +
              '<button class="button lb-edit-save" id="lbe-save-' + i + '">Save Changes</button>' +
              '<button class="button delete lb-edit-cancel" id="lbe-cancel-' + i + '">Cancel</button>' +
            '</div>' +
            '<p class="lb-edit-status" id="lbe-status-' + i + '"></p>';

          // Insert after current row
          row.after(panel);

          // Cancel button
          document.getElementById('lbe-cancel-' + i).addEventListener('click', function() {
            panel.remove();
          });

          // Save button
          document.getElementById('lbe-save-' + i).addEventListener('click', async function() {
            const saveBtn = document.getElementById('lbe-save-' + i);
            const statusEl = document.getElementById('lbe-status-' + i);
            const newChamp = parseInt(document.getElementById('lbe-champ-' + i).value) || 0;
            const newWins  = parseInt(document.getElementById('lbe-wins-' + i).value) || 0;
            const newLoss  = parseInt(document.getElementById('lbe-losses-' + i).value) || 0;
            const newGF    = parseInt(document.getElementById('lbe-gf-' + i).value) || 0;
            const newGA    = parseInt(document.getElementById('lbe-ga-' + i).value) || 0;

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            statusEl.textContent = '';

            // Use render()-scoped capture to avoid closure issues with let variable
            const supa = _supa;
            if (!supa) {
              statusEl.style.color = '#ff6b6b';
              statusEl.textContent = 'Supabase not connected.';
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save Changes';
              return;
            }

            try {
              // How this works:
              // - Brackets are the source of truth for real match results (never touched)
              // - We store admin adjustments as 'Admin Edit' rows in match_history
              // - The leaderboard adds bracket wins + admin-edit wins together
              // So: target = bracket_count + admin_edit_count
              //     admin_edit_count = target - bracket_count

              // Count what the bracket already shows for this team
              const localTourneys = loadTournaments();
              let bracketWins = 0, bracketLosses = 0;
              localTourneys.forEach(function(t) {
                if (!t.bracket) return;
                t.bracket.forEach(function(round) {
                  round.forEach(function(m) {
                    if (!m.winner || !m.team1 || !m.team2 || m.team2 === 'BYE') return;
                    if (m.team1 === team.name || m.team2 === team.name) {
                      if (m.winner === team.name) bracketWins++;
                      else bracketLosses++;
                    }
                  });
                });
              });

              // Delete all existing admin-edit rows for this team
              // Use separate queries (no .or()) to avoid PostgREST schema cache issues
              try {
                await supa.from('match_history').delete()
                  .eq('tournament_name', 'Admin Edit').eq('team1', team.name);
              } catch(delErr) { /* ignore */ }
              try {
                await supa.from('match_history').delete()
                  .eq('tournament_name', 'Admin Edit').eq('team2', team.name);
              } catch(delErr) { /* ignore */ }

              // Insert new admin-edit rows = target minus what bracket already provides
              const adjWins   = Math.max(0, newWins - bracketWins);
              const adjLosses = Math.max(0, newLoss - bracketLosses);

              for (let w = 0; w < adjWins; w++) {
                await supa.from('match_history').insert({
                  tournament_id: 'admin-edit',
                  tournament_name: 'Admin Edit',
                  round_index: 0,
                  team1: team.name,
                  team2: 'Admin Edit',
                  winner: team.name,
                  match_code: null,
                });
              }
              for (let l = 0; l < adjLosses; l++) {
                await supa.from('match_history').insert({
                  tournament_id: 'admin-edit',
                  tournament_name: 'Admin Edit',
                  round_index: 0,
                  team1: 'Admin Edit',
                  team2: team.name,
                  winner: 'Admin Edit',
                  match_code: null,
                });
              }

              // Championships note (cannot easily edit these without touching tournament records)
              const { data: champData } = await supa.from('tournaments')
                .select('id').eq('winner', team.name).eq('status', 'completed');
              const bracketChamps = (champData || []).length;
              if (newChamp !== bracketChamps) {
                statusEl.style.color = 'var(--gold)';
                statusEl.textContent = '⚠️ Championships (' + bracketChamps + ') can only be changed by editing the tournament winner record. W/L saved.';
              }

              // GF/GA: delete existing admin score_submission adjustments, insert fresh one
              // Delete GF/GA adjustments
              try {
                await supa.from('score_submissions').delete()
                  .eq('tournament_id', 'admin-edit').eq('admin_winner', team.name);
              } catch(delErr) { /* ignore */ }

              // Calculate current real GF/GA from bracket score submissions
              const { data: realSubs } = await supa.from('score_submissions')
                .select('admin_score_t1, admin_score_t2, tournament_id, round_index, match_index')
                .eq('status', 'approved')
                .neq('tournament_id', 'admin-edit');

              let curGF = 0, curGA = 0;
              (realSubs || []).forEach(function(sub) {
                if (sub.admin_score_t1 == null) return;
                const t = localTourneys.find(function(t) { return String(t.id) === String(sub.tournament_id); });
                if (!t || !t.bracket) return;
                const round = t.bracket[sub.round_index];
                if (!round) return;
                const match = round[sub.match_index];
                if (!match) return;
                if (match.team1 === team.name) { curGF += sub.admin_score_t1; curGA += sub.admin_score_t2; }
                else if (match.team2 === team.name) { curGF += sub.admin_score_t2; curGA += sub.admin_score_t1; }
              });

              const gfAdj = newGF - curGF;
              const gaAdj = newGA - curGA;
              if (gfAdj !== 0 || gaAdj !== 0) {
                await supa.from('score_submissions').insert({
                  tournament_id: 'admin-edit',
                  round_index: 0,
                  match_index: 0,
                  submitter_email: ADMIN_EMAIL,
                  reported_winner: team.name,
                  status: 'approved',
                  admin_score_t1: Math.max(0, gfAdj),
                  admin_score_t2: Math.max(0, gaAdj),
                  admin_winner: team.name,
                });
              }

              if (!statusEl.textContent) {
                statusEl.style.color = '#22c55e';
                statusEl.textContent = '✅ Saved successfully!';
              }
              saveBtn.textContent = 'Saved ✓';

              setTimeout(async function() {
                panel.remove();
                data = await buildLeaderboardData();
                render(key, dir);
              }, 1200);

            } catch(err) {
              statusEl.style.color = '#ff6b6b';
              statusEl.textContent = 'Error: ' + err.message;
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save Changes';
            }
          });
        });
        row.appendChild(dotsBtn);
      }

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
    const { data, error } = await supabaseClient.from('messages').insert({
      match_code: matchCode,
      tournament_id: tournamentId,
      sender_email: email,
      content: content.trim(),
    }).select('id').single();
    if (error) { console.error('Send message error:', error); return false; }
    return data || true; // return row with ID so doSend can deduplicate
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

  // Build email → discord_handle lookup map for all participants
  // Falls back to email if no handle is set
  const discordMap = {};
  const captainTeamMap = {};
  if (supabaseClient) {
    try {
      const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('email, discord_handle, gamertag');
      if (Array.isArray(profiles)) {
        profiles.forEach(function(p) {
          if (p.email) {
            discordMap[p.email.toLowerCase()] =
              p.discord_handle || p.gamertag || p.email;
          }
        });
      }
      // Also build email -> team name map so chat shows team names
      const { data: teamsData } = await supabaseClient
        .from('teams')
        .select('name, captain');
      if (Array.isArray(teamsData)) {
        teamsData.forEach(function(t) {
          if (t.captain && t.name) {
            captainTeamMap[t.captain.toLowerCase()] = t.name;
          }
        });
      }
    } catch(e) { /* silently fall back to email */ }
  }

  function getDisplayName(senderEmail) {
    if (!senderEmail) return 'Unknown';
    if (senderEmail === ADMIN_EMAIL) return '⚙️ Admin';
    // Show team name if available, fall back to discord handle, then email
    return captainTeamMap[senderEmail.toLowerCase()] || discordMap[senderEmail.toLowerCase()] || senderEmail;
  }

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
    // Show Discord handle (or gamertag) instead of email
    sender.textContent = getDisplayName(msg.sender_email);
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
  // Track IDs we've already rendered to avoid duplicates from optimistic updates
  const renderedIds = new Set();
  initial.forEach(msg => { if (msg.id) renderedIds.add(msg.id); });

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
      // Skip if we already showed this message via optimistic update
      if (payload.new?.id && renderedIds.has(payload.new.id)) return;
      if (payload.new?.id) renderedIds.add(payload.new.id);
      const newBubble = renderMessage(payload.new);
      messagesEl.appendChild(newBubble);
      if (isAdmin && payload.new?.id) addDeleteBtn(newBubble, payload.new.id, messagesEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    })
    .subscribe((status) => {
      console.log('[Chat] Realtime status for', matchCode, ':', status);
    });
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
    input.focus();

    // Optimistic update — show message immediately without waiting for Supabase
    const optimisticMsg = {
      id: null, // no ID yet — real-time event will be skipped by content match below
      sender_email: getCurrentUser(),
      content: val,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    const optimisticBubble = renderMessage(optimisticMsg);
    optimisticBubble.style.opacity = '0.75'; // slightly dim until confirmed
    messagesEl.appendChild(optimisticBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Send to Supabase — get back the real ID
    input.disabled = true;
    sendBtn.disabled = true;
    const result = await sendMatchMessage(matchCode, tournamentId, val);
    input.disabled = false;
    sendBtn.disabled = false;

    if (result && result.id) {
      // Mark as confirmed and register ID so real-time event is deduplicated
      optimisticBubble.style.opacity = '1';
      renderedIds.add(result.id);
    } else if (!result) {
      // Send failed — remove optimistic bubble and restore input
      optimisticBubble.remove();
      input.value = val;
    } else {
      // Sent OK but no ID returned — just make it fully opaque
      optimisticBubble.style.opacity = '1';
    }
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

// ── Floating chat button + slide-in panel ────────────────────────────────────
// Only shown when the current user is in an active match in the tournament being viewed.
// Call this after bracket is rendered.
async function initFloatingChat(tournament) {
  // Clean up any existing chat UI
  document.getElementById('floating-chat-bar')?.remove();
  document.getElementById('floating-chat-panel')?.remove();
  document.getElementById('floating-chat-overlay')?.remove();

  if (!tournament || tournament.status !== 'started') return;
  const email = getCurrentUser();
  if (!email) return;

  // Find active matches the user is in
  const myMatches = [];
  if (Array.isArray(tournament.bracket)) {
    tournament.bracket.forEach(function(round, rIdx) {
      round.forEach(function(match, mIdx) {
        if (!match.winner && match.team1 && match.team2 &&
            match.team2 !== 'BYE' && match.team1 !== 'BYE' &&
            match.code && isUserInMatch(match, tournament)) {
          myMatches.push({ match, rIdx, mIdx });
        }
      });
    });
  }
  if (myMatches.length === 0) return;

  // ── Build the chat bar (prominent, hard to miss) ──────────────────────────
  const bar = document.createElement('div');
  bar.id = 'floating-chat-bar';
  bar.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:calc(56px + env(safe-area-inset-bottom))',
    'z-index:1200',
    'background:var(--gold)',
    'color:#000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:0.6rem',
    'padding:0.75rem 1.25rem',
    'cursor:pointer',
    'font-family:Barlow Condensed,sans-serif',
    'font-weight:800',
    'font-size:1rem',
    'text-transform:uppercase',
    'letter-spacing:0.08em',
    'box-shadow:0 -2px 12px rgba(255,199,44,0.35)',
    'transition:filter 0.15s',
    'user-select:none',
    '-webkit-tap-highlight-color:transparent',
  ].join(';');
  bar.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' +
    '<span>💬 Match Chat — Tap to Open</span>' +
    '<span id="floating-chat-unread" style="background:#000;color:var(--gold);border-radius:999px;padding:0.1rem 0.5rem;font-size:0.75rem;display:none;">0</span>';

  document.body.appendChild(bar);

  // On desktop: push bar above bottom of screen (no tab bar)
  function adjustBarPosition() {
    const isMobile = window.innerWidth <= 768;
    bar.style.bottom = isMobile
      ? 'calc(56px + env(safe-area-inset-bottom))'
      : '0px';
  }
  adjustBarPosition();
  window.addEventListener('resize', adjustBarPosition);

  // ── Build the slide-up/slide-in panel ─────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'floating-chat-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1299;display:none;';
  document.body.appendChild(overlay);

  const panel = document.createElement('div');
  panel.id = 'floating-chat-panel';
  panel.style.cssText = [
    'position:fixed',
    'z-index:1300',
    'background:var(--card)',
    'display:flex',
    'flex-direction:column',
    'transition:transform 0.28s cubic-bezier(0.32,0.72,0,1)',
    // Mobile: full-width sheet from bottom
    'left:0',
    'right:0',
    'bottom:0',
    'top:auto',
    'height:85vh',
    'border-radius:20px 20px 0 0',
    'border-top:1px solid var(--border)',
    'transform:translateY(100%)',
    'box-shadow:0 -8px 32px rgba(0,0,0,0.4)',
  ].join(';');

  // Adjust for desktop
  function adjustPanel() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      panel.style.left = '0';
      panel.style.right = '0';
      panel.style.top = 'auto';
      panel.style.bottom = '0';
      panel.style.width = 'auto';
      panel.style.height = '85vh';
      panel.style.borderRadius = '20px 20px 0 0';
      panel.style.transform = isOpen ? 'translateY(0)' : 'translateY(100%)';
    } else {
      panel.style.left = 'auto';
      panel.style.right = '0';
      panel.style.top = '0';
      panel.style.bottom = '0';
      panel.style.width = 'min(380px, 100vw)';
      panel.style.height = 'auto';
      panel.style.borderRadius = '0';
      panel.style.transform = isOpen ? 'translateX(0)' : 'translateX(100%)';
    }
  }

  // Panel drag handle (mobile)
  const handle = document.createElement('div');
  handle.style.cssText = 'width:36px;height:4px;background:var(--border);border-radius:2px;margin:10px auto 0;flex-shrink:0;';
  panel.appendChild(handle);

  // Panel header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1.25rem;border-bottom:1px solid var(--border);flex-shrink:0;';
  const headerTitle = document.createElement('span');
  headerTitle.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:1.15rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--gold);';
  headerTitle.textContent = '💬 Match Chat';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer;padding:0.25rem 0.5rem;line-height:1;';
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Tabs if multiple matches
  let activeMatchIndex = 0;
  if (myMatches.length > 1) {
    const tabRow = document.createElement('div');
    tabRow.style.cssText = 'display:flex;border-bottom:1px solid var(--border);flex-shrink:0;';
    myMatches.forEach(function(m, i) {
      const tab = document.createElement('button');
      tab.textContent = 'Round ' + (m.rIdx + 1);
      tab.style.cssText = 'flex:1;padding:0.6rem;background:none;border:none;border-bottom:2px solid ' + (i === 0 ? 'var(--gold)' : 'transparent') + ';color:' + (i === 0 ? 'var(--gold)' : 'var(--text-muted)') + ';font-family:Barlow Condensed,sans-serif;font-weight:700;font-size:0.9rem;text-transform:uppercase;cursor:pointer;';
      tab.addEventListener('click', function() {
        activeMatchIndex = i;
        tabRow.querySelectorAll('button').forEach(function(b, bi) {
          b.style.borderBottomColor = bi === i ? 'var(--gold)' : 'transparent';
          b.style.color = bi === i ? 'var(--gold)' : 'var(--text-muted)';
        });
        loadChatForMatch(myMatches[i]);
      });
      tabRow.appendChild(tab);
    });
    panel.appendChild(tabRow);
  }

  // Chat area (takes remaining space)
  const chatArea = document.createElement('div');
  chatArea.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;';
  panel.appendChild(chatArea);

  document.body.appendChild(panel);

  // Load chat for a match
  async function loadChatForMatch(matchEntry) {
    chatArea.innerHTML = '';

    // Match code bar
    const codeBar = document.createElement('div');
    codeBar.style.cssText = 'padding:0.55rem 1.25rem;background:rgba(255,199,44,0.1);border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;gap:0.75rem;';
    const codeLabel = document.createElement('span');
    codeLabel.style.cssText = 'font-size:0.78rem;color:var(--text-muted);white-space:nowrap;';
    codeLabel.textContent = 'Match Code:';
    const codeVal = document.createElement('strong');
    codeVal.style.cssText = 'font-family:monospace;font-size:1.05rem;color:var(--gold);letter-spacing:0.1em;flex:1;';
    codeVal.textContent = matchEntry.match.code;
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy';
    copyBtn.style.cssText = 'background:none;border:1px solid var(--border);color:var(--text-muted);font-size:0.72rem;padding:0.2rem 0.55rem;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;flex-shrink:0;';
    copyBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(matchEntry.match.code).then(function() {
        copyBtn.textContent = '✅ Copied!';
        setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 2000);
      });
    });
    codeBar.appendChild(codeLabel);
    codeBar.appendChild(codeVal);
    codeBar.appendChild(copyBtn);
    chatArea.appendChild(codeBar);

    // Matchup label
    const matchupBar = document.createElement('div');
    matchupBar.style.cssText = 'padding:0.35rem 1.25rem;font-size:0.8rem;color:var(--text-muted);border-bottom:1px solid var(--border);flex-shrink:0;';
    matchupBar.textContent = matchEntry.match.team1 + ' vs ' + matchEntry.match.team2;
    chatArea.appendChild(matchupBar);

    // Chat container
    const chatContainer = document.createElement('div');
    chatContainer.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;';
    chatArea.appendChild(chatContainer);

    await renderMatchChat(matchEntry.match.code, tournament.id, chatContainer, false);

    // Style the chat wrapper to fill panel
    const chatWrapper = chatContainer.querySelector('.match-chat');
    if (chatWrapper) {
      chatWrapper.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;padding:0;border:none;background:none;border-radius:0;min-height:0;';
      const msgs = chatWrapper.querySelector('.chat-messages');
      if (msgs) msgs.style.cssText = 'flex:1;overflow-y:auto;padding:0.75rem 1.25rem;display:flex;flex-direction:column;gap:0.4rem;-webkit-overflow-scrolling:touch;';
      const inputRow = chatWrapper.querySelector('.chat-input-row');
      if (inputRow) {
        inputRow.style.cssText = 'padding:0.75rem 1.25rem;border-top:1px solid var(--border);display:flex;gap:0.5rem;flex-shrink:0;padding-bottom:calc(0.75rem + env(safe-area-inset-bottom));';
      }
      const titleEl = chatWrapper.querySelector('.chat-title');
      if (titleEl) titleEl.remove();
    }
  }

  // Open / close
  let isOpen = false;
  function openPanel() {
    isOpen = true;
    overlay.style.display = 'block';
    adjustPanel();
    bar.style.filter = 'brightness(0.85)';
    loadChatForMatch(myMatches[activeMatchIndex]);
  }
  function closePanel() {
    isOpen = false;
    const isMobile = window.innerWidth <= 768;
    panel.style.transform = isMobile ? 'translateY(100%)' : 'translateX(100%)';
    overlay.style.display = 'none';
    bar.style.filter = 'brightness(1)';
  }

  window.addEventListener('resize', function() {
    if (isOpen) adjustPanel();
  });

  bar.addEventListener('click', function() { isOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);
}

// ── Admin floating chat bar — shows list of all active match chats ───────────
async function initAdminChatBar(tournament) {
  // Clean up existing
  document.getElementById('floating-chat-bar')?.remove();
  document.getElementById('floating-chat-panel')?.remove();
  document.getElementById('floating-chat-overlay')?.remove();

  if (!tournament || tournament.status !== 'started') return;
  if (!supabaseClient) return;

  // ── Build bar ─────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'floating-chat-bar';
  bar.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' +
    '<span>⚙️ Admin Match Chats — View All</span>';
  document.body.appendChild(bar);

  // Adjust position same as player bar
  function adjustBarPosition() {
    const isMobile = window.innerWidth <= 768;
    bar.style.bottom = isMobile ? 'calc(56px + env(safe-area-inset-bottom))' : '0px';
  }
  adjustBarPosition();
  window.addEventListener('resize', adjustBarPosition);

  // ── Build overlay + panel ─────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'floating-chat-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1299;display:none;';
  document.body.appendChild(overlay);

  const panel = document.createElement('div');
  panel.id = 'floating-chat-panel';
  panel.style.cssText = [
    'position:fixed','z-index:1300','background:var(--card)',
    'display:flex','flex-direction:column',
    'transition:transform 0.28s cubic-bezier(0.32,0.72,0,1)',
    'left:0','right:0','bottom:0','top:auto','height:90vh',
    'border-radius:20px 20px 0 0','border-top:1px solid var(--border)',
    'transform:translateY(100%)','box-shadow:0 -8px 32px rgba(0,0,0,0.4)',
  ].join(';');

  function adjustPanel() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      panel.style.left = '0'; panel.style.right = '0'; panel.style.top = 'auto';
      panel.style.bottom = '0'; panel.style.width = 'auto'; panel.style.height = '90vh';
      panel.style.borderRadius = '20px 20px 0 0';
      panel.style.transform = isOpen ? 'translateY(0)' : 'translateY(100%)';
    } else {
      panel.style.left = 'auto'; panel.style.right = '0'; panel.style.top = '0';
      panel.style.bottom = '0'; panel.style.width = 'min(480px, 100vw)';
      panel.style.height = 'auto'; panel.style.borderRadius = '0';
      panel.style.transform = isOpen ? 'translateX(0)' : 'translateX(100%)';
    }
  }

  // Drag handle
  const handle = document.createElement('div');
  handle.style.cssText = 'width:36px;height:4px;background:var(--border);border-radius:2px;margin:10px auto 0;flex-shrink:0;';
  panel.appendChild(handle);

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1.25rem;border-bottom:1px solid var(--border);flex-shrink:0;';
  const headerTitle = document.createElement('span');
  headerTitle.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:1.15rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--gold);';
  headerTitle.textContent = '⚙️ All Match Chats';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer;padding:0.25rem 0.5rem;';
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Scrollable content area
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  panel.appendChild(body);

  document.body.appendChild(panel);

  // Load chat list — shows ALL bracket matches so admin can start any chat
  async function loadChatList() {
    body.innerHTML = '<p style="color:var(--text-muted);padding:1.25rem;font-size:0.9rem;">Loading chats...</p>';

    // Get matches that already have messages
    let seenCodes = {};
    try {
      const { data } = await supabaseClient
        .from('messages')
        .select('match_code, tournament_id, created_at')
        .order('created_at', { ascending: false });
      if (data) {
        data.forEach(function(m) {
          if (!seenCodes[m.match_code]) seenCodes[m.match_code] = m;
        });
      }
    } catch(e) {}

    body.innerHTML = '';

    // Build list from ALL bracket matches — not just ones with messages
    if (!Array.isArray(tournament.bracket) || tournament.bracket.length === 0) {
      body.innerHTML = '<p style="color:var(--text-muted);padding:1.25rem;font-size:0.9rem;">No bracket matches yet.</p>';
      return;
    }

    let matchCount = 0;
    tournament.bracket.forEach(function(round, rIdx) {
      round.forEach(function(match, mIdx) {
        if (!match.code || match.team1 === 'BYE' || match.team2 === 'BYE') return;
        matchCount++;
        const teams = { team1: match.team1, team2: match.team2 };
        const hasMessages = !!seenCodes[match.code];

        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1.25rem;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.12s;';
        item.addEventListener('mouseenter', function() { item.style.background = 'rgba(255,199,44,0.06)'; });
        item.addEventListener('mouseleave', function() { item.style.background = ''; });

        const left = document.createElement('div');
        const matchLabel = document.createElement('p');
        matchLabel.style.cssText = 'margin:0 0 0.2rem;font-weight:700;font-size:0.9rem;';
        matchLabel.textContent = match.team1 + ' vs ' + (match.team2 || 'BYE');
        const codeLabel = document.createElement('p');
        codeLabel.style.cssText = 'margin:0;font-family:monospace;font-size:0.78rem;color:var(--gold);';
        codeLabel.textContent = 'Code: ' + match.code + (match.winner ? ' ✅ Done' : '') + (hasMessages ? ' 💬' : '');
        left.appendChild(matchLabel);
        left.appendChild(codeLabel);

        const right = document.createElement('div');
        right.style.cssText = 'display:flex;align-items:center;gap:0.5rem;';
        const statusBadge = document.createElement('span');
        statusBadge.style.cssText = 'font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:10px;font-weight:700;' +
          (match.winner ? 'background:rgba(80,200,120,0.15);color:#50c878;' :
           hasMessages ? 'background:rgba(212,160,23,0.15);color:var(--gold);' :
           'background:rgba(255,255,255,0.06);color:var(--text-muted);');
        statusBadge.textContent = match.winner ? 'Completed' : hasMessages ? 'Active' : 'Open';
        const arrow = document.createElement('span');
        arrow.style.cssText = 'color:var(--text-muted);font-size:1.1rem;';
        arrow.textContent = '›';
        right.appendChild(statusBadge);
        right.appendChild(arrow);

        item.appendChild(left);
        item.appendChild(right);

        item.addEventListener('click', function() {
          openSingleChat(match.code, tournament.id, teams);
        });

        body.appendChild(item);
      });
    });

    if (matchCount === 0) {
      body.innerHTML = '<p style="color:var(--text-muted);padding:1.25rem;font-size:0.9rem;">No matches to chat with yet.</p>';
    }
  }

  // Open a single match chat inside the panel
  function openSingleChat(matchCode, tournamentId, teams) {
    body.innerHTML = '';

    // Back button
    const backBtn = document.createElement('button');
    backBtn.style.cssText = 'background:none;border:none;color:var(--gold);font-size:0.88rem;padding:0.75rem 1.25rem;cursor:pointer;display:flex;align-items:center;gap:0.4rem;font-family:Barlow Condensed,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;';
    backBtn.innerHTML = '← All Chats';
    backBtn.addEventListener('click', loadChatList);
    body.appendChild(backBtn);

    // Match code bar
    const codeBar = document.createElement('div');
    codeBar.style.cssText = 'padding:0.55rem 1.25rem;background:rgba(255,199,44,0.1);border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:0.75rem;';
    const codeVal = document.createElement('strong');
    codeVal.style.cssText = 'font-family:monospace;font-size:1rem;color:var(--gold);letter-spacing:0.1em;flex:1;';
    codeVal.textContent = 'Code: ' + matchCode;
    codeBar.appendChild(codeVal);
    if (teams) {
      const matchupLabel = document.createElement('span');
      matchupLabel.style.cssText = 'font-size:0.8rem;color:var(--text-muted);';
      matchupLabel.textContent = teams.team1 + ' vs ' + teams.team2;
      codeBar.appendChild(matchupLabel);
    }
    body.appendChild(codeBar);

    // Chat container
    const chatContainer = document.createElement('div');
    chatContainer.style.cssText = 'display:flex;flex-direction:column;height:calc(100% - 120px);';
    body.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;-webkit-overflow-scrolling:touch;';
    body.appendChild(chatContainer);

    renderMatchChat(matchCode, tournamentId || tournament.id, chatContainer, true);

    const chatWrapper = chatContainer.querySelector ? null : null;
    setTimeout(function() {
      const cw = chatContainer.querySelector('.match-chat');
      if (cw) {
        cw.style.cssText = 'display:flex;flex-direction:column;flex:1;padding:0;border:none;background:none;border-radius:0;';
        const msgs = cw.querySelector('.chat-messages');
        if (msgs) msgs.style.cssText = 'flex:1;overflow-y:auto;padding:0.75rem 1.25rem;display:flex;flex-direction:column;gap:0.4rem;';
        const inputRow = cw.querySelector('.chat-input-row');
        if (inputRow) inputRow.style.cssText = 'padding:0.75rem 1.25rem;border-top:1px solid var(--border);display:flex;gap:0.5rem;flex-shrink:0;';
        const titleEl = cw.querySelector('.chat-title');
        if (titleEl) titleEl.remove();
      }
    }, 50);
  }

  // Open / close
  let isOpen = false;
  function openPanel() {
    isOpen = true;
    overlay.style.display = 'block';
    adjustPanel();
    bar.style.filter = 'brightness(0.85)';
    loadChatList();
  }
  function closePanel() {
    isOpen = false;
    const isMobile = window.innerWidth <= 768;
    panel.style.transform = isMobile ? 'translateY(100%)' : 'translateX(100%)';
    overlay.style.display = 'none';
    bar.style.filter = 'brightness(1)';
  }

  window.addEventListener('resize', function() { if (isOpen) adjustPanel(); });
  bar.addEventListener('click', function() { isOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);
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
  const tournament = tournaments.find((t) => String(t.id) === String(id));
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
    const idx = tournaments.findIndex((t) => String(t.id) === String(id));
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
  // Display start date + time
  if (tournament.startDate) {
    const startP = document.createElement('p');
    startP.textContent = 'Start: ' + formatTournamentDateTime(tournament.startDate, tournament.startTime);
    detail.appendChild(startP);
  }

  // Quick info badges row
  const infoBadges = document.createElement('div');
  infoBadges.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem;margin:0.5rem 0 1rem;';
  const entryFeeBadge = document.createElement('span');
  const feeAmt = parseFloat(tournament.entry_fee || tournament.entryFee) || 0;
  entryFeeBadge.style.cssText = 'padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:600;' +
    (feeAmt > 0 ? 'background:rgba(212,160,23,0.15);border:1px solid rgba(212,160,23,0.4);color:#d4a017;' : 'background:rgba(80,200,120,0.1);border:1px solid rgba(80,200,120,0.3);color:#50c878;');
  entryFeeBadge.textContent = feeAmt > 0 ? '💰 $' + feeAmt.toFixed(2) + ' Entry' : '🆓 Free Entry';
  infoBadges.appendChild(entryFeeBadge);
  if (tournament.goalieRequired) {
    const goalieBadge = document.createElement('span');
    goalieBadge.style.cssText = 'padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:600;background:rgba(255,199,44,0.12);border:1px solid rgba(255,199,44,0.4);color:#ffc72c;';
    goalieBadge.textContent = '🥅 Goalie Required';
    infoBadges.appendChild(goalieBadge);
  }
  const formatBadge = document.createElement('span');
  formatBadge.style.cssText = 'padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:600;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text-muted);';
  formatBadge.textContent = '⚡ Single Elimination · 3 Min Periods';
  infoBadges.appendChild(formatBadge);
  const crossplayBadge = document.createElement('span');
  crossplayBadge.style.cssText = 'padding:0.2rem 0.65rem;border-radius:20px;font-size:0.78rem;font-weight:600;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text-muted);';
  crossplayBadge.textContent = '🎮 PS5 + Xbox · NA-East';
  infoBadges.appendChild(crossplayBadge);
  detail.appendChild(infoBadges);

  // ── Check-In Required banner (always visible) ──────────────────────────
  const checkInBanner = document.createElement('div');
  checkInBanner.style.cssText = 'background:linear-gradient(135deg,rgba(255,199,44,0.12),rgba(255,199,44,0.06));border:1px solid rgba(255,199,44,0.5);border-left:4px solid #d4a017;border-radius:var(--radius-sm);padding:0.85rem 1rem;margin-bottom:1rem;';
  checkInBanner.innerHTML =
    '<p style="font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:0.95rem;text-transform:uppercase;letter-spacing:0.06em;color:#d4a017;margin:0 0 0.4rem;">⏰ Check-In Required</p>' +
    '<p style="color:var(--text);font-size:0.85rem;line-height:1.6;margin:0;">' +
      'All registered teams must <strong>check in 10 minutes before</strong> the tournament starts to hold their spot. ' +
      'If you do not check in by start time, your spot gets cycled to the next team in the waitlist.' +
    '</p>' +
    '<p style="color:var(--text-muted);font-size:0.78rem;margin:0.4rem 0 0;">📢 Watch the Discord announcements channel — we will ping when check-in opens.</p>';
  detail.appendChild(checkInBanner);

  // Quick rules card
  const quickRules = document.createElement('div');
  quickRules.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid var(--border);border-left:3px solid #d4a017;border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.82rem;color:var(--text-muted);line-height:1.6;';
  quickRules.innerHTML =
    '<p style="font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.06em;color:#d4a017;margin:0 0 0.4rem;">📋 Quick Rules</p>' +
    '<p style="margin:0;">• Private Match · World of CHEL → Clubs → Play → Private Match</p>' +
    '<p style="margin:0;">• Highest seed = Home side &nbsp;|&nbsp; NA‑East servers &nbsp;|&nbsp; Crossplay ON</p>' +
    '<p style="margin:0;color:#ff6b6b;font-weight:600;">• Lag-outs = DQ &nbsp;|&nbsp; No screenshot = no win</p>' +
    '<p style="margin:0;font-size:0.78rem;margin-top:0.3rem;"><a href="rules.html" style="color:#d4a017;">View full rules →</a></p>';
  detail.appendChild(quickRules);
  // Display champion if tournament completed
  if (tournament.status === 'completed' && tournament.winner) {
    const champTitle = document.createElement('h3');
    champTitle.textContent = 'Champion: ' + tournament.winner;
    detail.appendChild(champTitle);
    // Show prize pool payout info
    const prizePool = formatPrizePool(tournament);
    if (prizePool) {
      const prizeMsg = document.createElement('div');
      prizeMsg.style.cssText = 'background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.4);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-top:0.5rem;font-size:0.9rem;color:#ffd700;font-weight:600;';
      prizeMsg.innerHTML = `🏆 Prize: <strong>${prizePool}</strong> — Winner, check your Discord DMs from the admin to claim your prize!`;
      detail.appendChild(prizeMsg);
    }
  }
  // Show current and maximum team slots if available
  if (tournament.maxTeams) {
    const maxInfo = document.createElement('p');
    const currentCount = tournament.teams ? tournament.teams.length : 0;
    maxInfo.textContent = 'Teams: ' + currentCount + ' / ' + tournament.maxTeams;
    detail.appendChild(maxInfo);
  }
  // Prize pool display
  const prizePool = formatPrizePool(tournament);
  if (prizePool && tournament.status !== 'completed') {
    const poolEl = document.createElement('div');
    poolEl.style.cssText = 'display:inline-flex;align-items:center;gap:0.5rem;background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.4);border-radius:var(--radius-sm);padding:0.5rem 1rem;margin:0.5rem 0;font-weight:700;color:#ffd700;font-size:1rem;';
    poolEl.innerHTML = `🏆 Current Prize Pool: <strong>${prizePool}</strong>`;
    detail.appendChild(poolEl);
  }
  // Teams list
  if (tournament.teams && tournament.teams.length > 0) {
    const teamsHeading = document.createElement('h3');
    teamsHeading.textContent = 'Registered Teams';
    const teamsList = document.createElement('ul');
      teamsList.className = 'teams-list';
    tournament.teams.forEach((team, seedIdx) => {
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
      const seedLabel = (seedIdx + 1) + '. ';
      /*
       * We only display team names in the list to protect user privacy.  
       * Admins can still remove teams, but we avoid showing email or Discord
       * information here.  When the admin dashboard needs detailed
       * information, it fetches directly from Supabase.
       */
      if (role === 'admin') {
        // For admins, display remove button at all times (including after start)
        const nameSpan = document.createElement('span');
        nameSpan.textContent = seedLabel + name;
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
        // Non-admin view: show seed + team name
        li.textContent = seedLabel + name;
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

    // Show goalie required notice always if applicable
    if (tournament.goalieRequired) {
      const goalieNotice = document.createElement('div');
      goalieNotice.style.cssText = 'background:rgba(255,199,44,0.1);border:1px solid var(--gold);border-radius:var(--radius-sm);padding:0.6rem 0.9rem;margin-bottom:1rem;font-size:0.88rem;color:var(--gold);font-weight:600;display:flex;align-items:center;gap:0.5rem;';
      goalieNotice.innerHTML = '🥅 <span>Goalie Required — your team must have a goalie to compete in this tournament.</span>';
      detail.appendChild(goalieNotice);
    }

    if (!currentTeam) {
      // No team yet
      const noTeamMsg = document.createElement('p');
      noTeamMsg.textContent = 'You need to create a team before you can register.';
      detail.appendChild(noTeamMsg);
      const link = document.createElement('a');
      link.href = 'tournaments.html';
      link.textContent = 'Create a team here.';
      detail.appendChild(link);
    } else {
      const entryFee = parseFloat(tournament.entry_fee || tournament.entryFee) || 0;
      const isFree = entryFee === 0;
      const alreadyRegistered = tournament.teams && tournament.teams.some((team) => String(team.id) === String(currentTeam.id));
      const isFull = maxCount && currentCount >= maxCount;

      if (alreadyRegistered) {
        // ── Already registered: show check-in button if check-in is open ──
        if (tournament.status === 'check_in') {
          (async function() {
            // Check if already checked in
            let checkedIn = false;
            if (supabaseClient) {
              try {
                const { data } = await supabaseClient
                  .from('tournament_registrations')
                  .select('checked_in')
                  .eq('tournament_id', String(tournament.id))
                  .eq('team_id', String(currentTeam.id))
                  .single();
                checkedIn = data && data.checked_in;
              } catch(e) {}
            }
            if (checkedIn) {
              const checkedMsg = document.createElement('div');
              checkedMsg.style.cssText = 'background:rgba(80,200,120,0.12);border:1px solid rgba(80,200,120,0.4);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-top:1rem;color:#50c878;font-weight:700;font-size:0.95rem;';
              checkedMsg.textContent = '✅ You are checked in and ready!';
              detail.appendChild(checkedMsg);
            } else {
              const checkInBtn = document.createElement('button');
              checkInBtn.className = 'button';
              checkInBtn.style.cssText = 'margin-top:1rem;background:linear-gradient(135deg,#50c878,#2ecc71);color:#000;font-weight:800;font-size:1rem;width:100%;';
              checkInBtn.textContent = '✅ Check In Now';
              checkInBtn.addEventListener('click', async function() {
                checkInBtn.disabled = true;
                checkInBtn.textContent = 'Checking in...';
                const ok = await checkInTeam(tournament.id, currentTeam.id);
                if (ok) {
                  checkInBtn.textContent = '✅ Checked In!';
                  checkInBtn.style.background = 'rgba(80,200,120,0.2)';
                  checkInBtn.style.color = '#50c878';
                  checkInBtn.style.border = '1px solid #50c878';
                } else {
                  checkInBtn.disabled = false;
                  checkInBtn.textContent = '✅ Check In Now';
                  alert('Check-in failed. Please try again.');
                }
              });
              const checkInNote = document.createElement('p');
              checkInNote.style.cssText = 'color:#ff6b6b;font-size:0.82rem;margin-top:0.4rem;';
              checkInNote.textContent = '⚠️ Check-in is open — confirm your spot or you may be removed from the bracket.';
              detail.appendChild(checkInBtn);
              detail.appendChild(checkInNote);
            }
          })();
        } else {
          const registeredMsg = document.createElement('p');
          registeredMsg.style.cssText = 'color:var(--gold);font-weight:600;margin-top:0.5rem;';
          registeredMsg.textContent = '✅ Your team is registered for this tournament.';
          detail.appendChild(registeredMsg);
        }
      } else if (isFull && isFree && (tournament.status === 'open' || tournament.status === 'check_in')) {
        // ── Tournament full + free → offer waitlist ──
        (async function() {
          let onWaitlist = false;
          let waitlistPos = null;
          if (supabaseClient) {
            try {
              const { data } = await supabaseClient
                .from('tournament_registrations')
                .select('waitlisted, waitlist_position')
                .eq('tournament_id', String(tournament.id))
                .eq('team_id', String(currentTeam.id))
                .single();
              onWaitlist = data && data.waitlisted;
              waitlistPos = data && data.waitlist_position;
            } catch(e) {}
          }
          if (onWaitlist) {
            const wlMsg = document.createElement('div');
            wlMsg.style.cssText = 'background:rgba(212,160,23,0.1);border:1px solid rgba(212,160,23,0.3);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-top:1rem;';
            wlMsg.innerHTML = '<p style="color:var(--gold);font-weight:700;margin:0 0 0.25rem;">⏳ You are on the waitlist</p>' +
              '<p style="color:var(--text-muted);font-size:0.85rem;margin:0;">Position #' + waitlistPos + ' — we will notify you if a spot opens up.</p>';
            detail.appendChild(wlMsg);
          } else {
            const fullMsg = document.createElement('p');
            fullMsg.style.cssText = 'color:#ff6b6b;font-weight:600;margin-top:0.5rem;';
            fullMsg.textContent = 'Tournament is full.';
            detail.appendChild(fullMsg);
            const wlBtn = document.createElement('button');
            wlBtn.className = 'button';
            wlBtn.style.cssText = 'margin-top:0.5rem;background:transparent;border-color:var(--gold);color:var(--gold);';
            wlBtn.textContent = '⏳ Join Waitlist';
            wlBtn.addEventListener('click', async function() {
              checkDiscordGate(async function() {
                wlBtn.disabled = true;
                wlBtn.textContent = 'Joining...';
                const ok = await joinWaitlist(tournament.id, currentTeam.id);
                if (ok) {
                  renderTournamentDetails(tournament.id);
                } else {
                  wlBtn.disabled = false;
                  wlBtn.textContent = '⏳ Join Waitlist';
                  alert('Could not join waitlist. Please try again.');
                }
              });
            });
            const wlNote = document.createElement('p');
            wlNote.style.cssText = 'color:var(--text-muted);font-size:0.8rem;margin-top:0.3rem;';
            wlNote.textContent = 'No payment required. You will be notified if a spot opens.';
            detail.appendChild(fullMsg);
            detail.appendChild(wlBtn);
            detail.appendChild(wlNote);
          }
        })();
      } else if (!isFull && tournament.status !== 'check_in') {
        // ── Normal registration ──
        const registerBtn = document.createElement('button');
        registerBtn.textContent = entryFee > 0
          ? '💳 Pay $' + entryFee.toFixed(2) + ' & Register'
          : 'Register Your Team';
        registerBtn.className = 'button';
        registerBtn.style.marginTop = '1rem';
        registerBtn.addEventListener('click', async function () {
          checkDiscordGate(async function() {
            registerBtn.disabled = true;
            registerBtn.textContent = 'Loading...';
            try {
              if (entryFee > 0) {
                openEntryInfoModal({
                  tournament,
                  teamId: currentTeam.id,
                  entryFee,
                  onConfirm: function() {
                    if (typeof window.openStripeModal === 'function') {
                      window.openStripeModal({
                        tournamentId: tournament.id,
                        teamId: currentTeam.id,
                        amount: entryFee,
                        tournamentName: tournament.name,
                      });
                    } else {
                      alert('Payment system not loaded. Please refresh the page.');
                    }
                  }
                });
                registerBtn.disabled = false;
                registerBtn.textContent = '💳 Pay $' + entryFee.toFixed(2) + ' & Register';
              } else {
                registerTeamToTournament(tournament.id, currentTeam.id);
                if (typeof syncTournamentsFromBackend === 'function') {
                  await syncTournamentsFromBackend().catch(() => {});
                }
                renderTournamentDetails(tournament.id);
              }
            } catch(e) {
              console.error('Registration error:', e);
              registerBtn.disabled = false;
              registerBtn.textContent = entryFee > 0 ? '💳 Pay $' + entryFee.toFixed(2) + ' & Register' : 'Register Your Team';
            }
          });
        });
        detail.appendChild(registerBtn);
      } else {
        const fullMsg = document.createElement('p');
        fullMsg.textContent = 'Registration is full for this tournament.';
        detail.appendChild(fullMsg);
      }
    }
  }
  // Bracket
  if ((tournament.status === 'started' || tournament.status === 'completed') && tournament.bracket) {
    const bracketHeading = document.createElement('h3');
    bracketHeading.innerHTML = 'Bracket <span class="bracket-live-dot" title="Live — updates automatically"></span>';
    const bracketDiv = document.createElement('div');
    bracketDiv.className = 'bracket';
    tournament.bracket.forEach((round, rIndex) => {
      const roundDiv = document.createElement('div');
      roundDiv.className = 'round';
      const roundTitle = document.createElement('h4');
      roundTitle.textContent = 'Round ' + (rIndex + 1);
      roundDiv.appendChild(roundTitle);
      const matchGrid = document.createElement('div');
      matchGrid.className = 'match-grid';
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
const showCode = role === 'admin' || isUserInMatch(match, tournament);
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
          (tournament.status === 'started' || tournament.status === 'completed') &&
          match.team1 && match.team1 !== 'BYE' &&
          match.team2 && match.team2 !== 'BYE' &&
          !match.winner
        ) {
          const reportDiv = document.createElement('div');
          reportDiv.className = 'report-score';
          reportDiv.style.cssText = 'display:flex;flex-direction:column;gap:0.4rem;margin-top:0.5rem;';

          // Winner select
          const select = document.createElement('select');
          const defOpt = document.createElement('option');
          defOpt.value = ''; defOpt.textContent = 'Select winner';
          select.appendChild(defOpt);
          const opt1 = document.createElement('option');
          opt1.value = match.team1; opt1.textContent = match.team1;
          select.appendChild(opt1);
          const opt2 = document.createElement('option');
          opt2.value = match.team2; opt2.textContent = match.team2;
          select.appendChild(opt2);
          reportDiv.appendChild(select);

          // Score inputs
          const scoreRow = document.createElement('div');
          scoreRow.style.cssText = 'display:flex;gap:0.4rem;align-items:center;';
          const scoreT1 = document.createElement('input');
          scoreT1.type = 'number'; scoreT1.min = '0'; scoreT1.max = '99';
          scoreT1.placeholder = match.team1 + ' goals';
          scoreT1.className = 'score-input score-admin-input';
          scoreT1.style.cssText = 'flex:1;';
          const scoreSep = document.createElement('span');
          scoreSep.textContent = '—';
          scoreSep.style.cssText = 'color:var(--text-muted);font-size:0.85rem;';
          const scoreT2 = document.createElement('input');
          scoreT2.type = 'number'; scoreT2.min = '0'; scoreT2.max = '99';
          scoreT2.placeholder = match.team2 + ' goals';
          scoreT2.className = 'score-input score-admin-input';
          scoreT2.style.cssText = 'flex:1;';
          scoreRow.appendChild(scoreT1);
          scoreRow.appendChild(scoreSep);
          scoreRow.appendChild(scoreT2);
          reportDiv.appendChild(scoreRow);

          const reportBtn = document.createElement('button');
          reportBtn.textContent = 'Report Score';
          reportBtn.className = 'button';
          reportBtn.addEventListener('click', function () {
            const winnerName = select.value;
            if (!winnerName) { alert('Please select a winner.'); return; }
            const t1Score = scoreT1.value !== '' ? parseInt(scoreT1.value) : null;
            const t2Score = scoreT2.value !== '' ? parseInt(scoreT2.value) : null;
            reportMatchResult(tournament.id, rIndex, mIndex, winnerName, t1Score, t2Score);
            renderTournamentDetails(tournament.id);
          });
          reportDiv.appendChild(reportBtn);
          matchDiv.appendChild(reportDiv);
        }

        // ── Admin: Edit Match slot (rearrange bracket) ──────────────────────
        if (role === 'admin' && (tournament.status === 'started' || tournament.status === 'completed')) {
          const editMatchBtn = document.createElement('button');
          editMatchBtn.className = 'button';
          editMatchBtn.textContent = '✏️ Edit Match';
          editMatchBtn.style.cssText = 'font-size:0.75rem;padding:0.25rem 0.6rem;margin-top:0.35rem;background:transparent;border-color:rgba(255,255,255,0.2);color:var(--text-muted);';

          editMatchBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            // Toggle panel
            const panelId = 'edit-match-' + rIndex + '-' + mIndex;
            const existing = document.getElementById(panelId);
            if (existing) { existing.remove(); return; }
            // Close any other open edit panels
            document.querySelectorAll('.edit-match-panel').forEach(p => p.remove());

            // Build team options — registered teams + BYE + TBD
            const allTeamNames = ['BYE', 'TBD'];
            (tournament.teams || []).forEach(function(t) {
              const n = typeof t === 'string' ? t : t.name;
              if (n && !allTeamNames.includes(n)) allTeamNames.push(n);
            });

            const panel = document.createElement('div');
            panel.className = 'edit-match-panel';
            panel.id = panelId;
            panel.innerHTML =
              '<p class="edit-match-title">✏️ Edit Match Slot</p>' +
              '<p class="edit-match-note">Pick from the dropdown or type any team name in the custom field. Changing a team resets the winner and generates a new match code.</p>' +
              '<div class="edit-match-row">' +
                '<label>Team 1 <span style="color:var(--text-dim);font-size:0.65rem;">(select or type below)</span>' +
                  '<select id="em-t1-' + panelId + '" style="margin-bottom:0.3rem;">' +
                    allTeamNames.map(function(n) {
                      return '<option value="' + n + '"' + (n === match.team1 ? ' selected' : '') + '>' + n + '</option>';
                    }).join('') +
                  '</select>' +
                  '<input type="text" id="em-t1c-' + panelId + '" placeholder="Or type custom name..." style="padding:0.35rem 0.5rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.8rem;width:100%;" />' +
                '</label>' +
                '<span class="edit-match-vs">vs</span>' +
                '<label>Team 2 <span style="color:var(--text-dim);font-size:0.65rem;">(select or type below)</span>' +
                  '<select id="em-t2-' + panelId + '" style="margin-bottom:0.3rem;">' +
                    allTeamNames.map(function(n) {
                      return '<option value="' + n + '"' + (n === match.team2 ? ' selected' : '') + '>' + n + '</option>';
                    }).join('') +
                  '</select>' +
                  '<input type="text" id="em-t2c-' + panelId + '" placeholder="Or type custom name..." style="padding:0.35rem 0.5rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.8rem;width:100%;" />' +
                '</label>' +
              '</div>' +
              '<div class="edit-match-actions">' +
                '<button class="button" id="em-save-' + panelId + '">Save Changes</button>' +
                '<button class="button delete" id="em-cancel-' + panelId + '">Cancel</button>' +
              '</div>' +
              '<p class="edit-match-status" id="em-status-' + panelId + '"></p>';

            matchDiv.appendChild(panel);

            document.getElementById('em-cancel-' + panelId).addEventListener('click', function() {
              panel.remove();
            });

            document.getElementById('em-save-' + panelId).addEventListener('click', async function() {
              const saveBtn = document.getElementById('em-save-' + panelId);
              const statusEl = document.getElementById('em-status-' + panelId);
              const t1Custom = (document.getElementById('em-t1c-' + panelId)?.value || '').trim();
              const t2Custom = (document.getElementById('em-t2c-' + panelId)?.value || '').trim();
              const newT1 = t1Custom || document.getElementById('em-t1-' + panelId).value;
              const newT2 = t2Custom || document.getElementById('em-t2-' + panelId).value;

              if (!newT1 || !newT2) { statusEl.textContent = 'Both slots required.'; return; }
              if (newT1 === newT2 && newT1 !== 'BYE' && newT1 !== 'TBD') {
                statusEl.textContent = 'Team 1 and Team 2 cannot be the same.';
                return;
              }

              saveBtn.disabled = true;
              saveBtn.textContent = 'Saving...';

              try {
                let tournaments2 = loadTournaments();
                const tIdx = tournaments2.findIndex(function(t) { return t.id === tournament.id; });
                if (tIdx === -1) throw new Error('Tournament not found');
                const bracket2 = tournaments2[tIdx].bracket;
                const targetMatch = bracket2[rIndex][mIndex];
                const oldWinner = targetMatch.winner;
                const changed = newT1 !== targetMatch.team1 || newT2 !== targetMatch.team2;

                // Update the match slot
                targetMatch.team1 = newT1;
                targetMatch.team2 = newT2;
                // Reset winner and generate new code only if teams changed
                if (changed) {
                  targetMatch.winner = null;
                  targetMatch.code = generateCode(null);
                  // Clear propagated winner in next round if this match had a winner
                  if (oldWinner && bracket2[rIndex + 1]) {
                    const nextMatchIdx = Math.floor(mIndex / 2);
                    const nextMatch = bracket2[rIndex + 1][nextMatchIdx];
                    if (nextMatch) {
                      if (mIndex % 2 === 0 && nextMatch.team1 === oldWinner) {
                        nextMatch.team1 = 'TBD';
                        nextMatch.winner = null;
                      } else if (mIndex % 2 !== 0 && nextMatch.team2 === oldWinner) {
                        nextMatch.team2 = 'TBD';
                        nextMatch.winner = null;
                      }
                    }
                  }
                }

                // If editing the final round match of a completed tournament,
                // reset tournament winner and status back to started
                const isFinalRound = rIndex === bracket2.length - 1;
                if (isFinalRound && changed && tournaments2[tIdx].status === 'completed') {
                  tournaments2[tIdx].winner = null;
                  tournaments2[tIdx].status = 'started';
                }

                saveTournaments(tournaments2);

                // Push to backend
                const patchRes = await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournament.id), {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bracket: bracket2, status: tournaments2[tIdx].status, winner: tournaments2[tIdx].winner || null }),
                });
                const patchData = await patchRes.json();
                if (!patchData.ok) throw new Error('Backend save failed');

                statusEl.style.color = '#22c55e';
                statusEl.textContent = '✅ Match updated!';
                saveBtn.textContent = 'Saved ✓';

                setTimeout(function() {
                  panel.remove();
                  renderTournamentDetails(tournament.id);
                }, 800);

              } catch(err) {
                statusEl.style.color = '#ff6b6b';
                statusEl.textContent = 'Error: ' + err.message;
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Changes';
              }
            });
          });

          matchDiv.appendChild(editMatchBtn);

          // ── Advance button (marks match as advanced, no score, no cascade) ─
          if (!match.winner && !match.advanced) {
            const advRow = document.createElement('div');
            advRow.style.cssText = 'display:flex;gap:0.4rem;margin-top:0.35rem;flex-wrap:wrap;';

            if (match.team1 && match.team1 !== 'BYE' && match.team1 !== 'TBD') {
              const advBtn1 = document.createElement('button');
              advBtn1.className = 'button';
              advBtn1.textContent = '⏭ Advance ' + match.team1;
              advBtn1.style.cssText = 'font-size:0.72rem;padding:0.25rem 0.55rem;background:transparent;border-color:rgba(255,199,44,0.35);color:var(--text-muted);';
              advBtn1.addEventListener('click', async function() {
                if (!confirm('Mark "' + match.team1 + '" as advanced (no score recorded)?')) return;
                advBtn1.disabled = true;
                const advancedTeam = match.team1;
                const updatedBracket = JSON.parse(JSON.stringify(tournament.bracket));
                updatedBracket[rIndex][mIndex].advanced = advancedTeam;
                updatedBracket[rIndex][mIndex].winner = advancedTeam;
                // Propagate to next round
                if (updatedBracket[rIndex + 1]) {
                  const nextMatchIdx = Math.floor(mIndex / 2);
                  const nextMatch = updatedBracket[rIndex + 1][nextMatchIdx];
                  if (nextMatch) {
                    if (mIndex % 2 === 0) nextMatch.team1 = advancedTeam;
                    else nextMatch.team2 = advancedTeam;
                  }
                }
                // Save to localStorage
                let t2 = loadTournaments();
                const tIdx = t2.findIndex(function(x) { return String(x.id) === String(tournament.id); });
                if (tIdx !== -1) { t2[tIdx].bracket = updatedBracket; saveTournaments(t2); }
                // Save to Supabase + backend
                try {
                  if (supabaseClient) await supabaseClient.from('tournaments').update({ bracket: updatedBracket }).eq('id', tournament.id);
                  await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournament.id), {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bracket: updatedBracket }),
                  });
                } catch(e) { console.error('Advance save error:', e); }
                renderTournamentDetails(tournament.id);
              });
              advRow.appendChild(advBtn1);
            }

            if (match.team2 && match.team2 !== 'BYE' && match.team2 !== 'TBD') {
              const advBtn2 = document.createElement('button');
              advBtn2.className = 'button';
              advBtn2.textContent = '⏭ Advance ' + match.team2;
              advBtn2.style.cssText = 'font-size:0.72rem;padding:0.25rem 0.55rem;background:transparent;border-color:rgba(255,199,44,0.35);color:var(--text-muted);';
              advBtn2.addEventListener('click', async function() {
                if (!confirm('Mark "' + match.team2 + '" as advanced (no score recorded)?')) return;
                advBtn2.disabled = true;
                const advancedTeam = match.team2;
                const updatedBracket = JSON.parse(JSON.stringify(tournament.bracket));
                updatedBracket[rIndex][mIndex].advanced = advancedTeam;
                updatedBracket[rIndex][mIndex].winner = advancedTeam;
                // Propagate to next round
                if (updatedBracket[rIndex + 1]) {
                  const nextMatchIdx = Math.floor(mIndex / 2);
                  const nextMatch = updatedBracket[rIndex + 1][nextMatchIdx];
                  if (nextMatch) {
                    if (mIndex % 2 === 0) nextMatch.team1 = advancedTeam;
                    else nextMatch.team2 = advancedTeam;
                  }
                }
                // Save to localStorage
                let t2 = loadTournaments();
                const tIdx = t2.findIndex(function(x) { return String(x.id) === String(tournament.id); });
                if (tIdx !== -1) { t2[tIdx].bracket = updatedBracket; saveTournaments(t2); }
                // Save to Supabase + backend
                try {
                  if (supabaseClient) await supabaseClient.from('tournaments').update({ bracket: updatedBracket }).eq('id', tournament.id);
                  await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournament.id), {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bracket: updatedBracket }),
                  });
                } catch(e) { console.error('Advance save error:', e); }
                renderTournamentDetails(tournament.id);
              });
              advRow.appendChild(advBtn2);
            }

            // ── Clear match button ──────────────────────────────────────────
            const clearBtn = document.createElement('button');
            clearBtn.className = 'button delete';
            clearBtn.textContent = '✖ Clear Match';
            clearBtn.style.cssText = 'font-size:0.72rem;padding:0.25rem 0.55rem;';
            clearBtn.addEventListener('click', async function() {
              if (!confirm('Clear this match? Both slots will be set to TBD. Later rounds will NOT be affected.')) return;
              let t2 = loadTournaments();
              const tIdx = t2.findIndex(function(x) { return x.id === tournament.id; });
              if (tIdx === -1) return;
              const m = t2[tIdx].bracket[rIndex][mIndex];
              m.team1 = 'TBD';
              m.team2 = 'TBD';
              m.winner = null;
              m.advanced = null;
              m.code = generateCode(null);
              saveTournaments(t2);
              try {
                await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournament.id), {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bracket: t2[tIdx].bracket }),
                });
              } catch(e) { console.error('Clear match save error:', e); }
              renderTournamentDetails(tournament.id);
            });
            advRow.appendChild(clearBtn);

            // ── Delete match button (only for empty/bye/tbd matches) ────────
            const isEmpty = function(name) {
              return !name || name === 'BYE' || name === 'TBD';
            };
            if (isEmpty(match.team1) && isEmpty(match.team2)) {
              const deleteMatchBtn = document.createElement('button');
              deleteMatchBtn.className = 'button delete';
              deleteMatchBtn.textContent = '🗑 Delete Match';
              deleteMatchBtn.style.cssText = 'font-size:0.72rem;padding:0.25rem 0.55rem;background:#8b0000;border-color:#cc0000;';
              deleteMatchBtn.addEventListener('click', async function() {
                if (!confirm('Permanently delete this match from the bracket? This cannot be undone.')) return;
                let t2 = loadTournaments();
                const tIdx = t2.findIndex(function(x) { return x.id === tournament.id; });
                if (tIdx === -1) return;
                // Remove this match from the round
                t2[tIdx].bracket[rIndex].splice(mIndex, 1);
                // If round is now empty, remove the round too
                if (t2[tIdx].bracket[rIndex].length === 0) {
                  t2[tIdx].bracket.splice(rIndex, 1);
                }
                saveTournaments(t2);
                try {
                  await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournament.id), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bracket: t2[tIdx].bracket }),
                  });
                } catch(e) { console.error('Delete match error:', e); }
                renderTournamentDetails(tournament.id);
              });
              advRow.appendChild(deleteMatchBtn);
            }

            matchDiv.appendChild(advRow);
          }

          // Show advanced label if match was advanced
          if (match.advanced) {
            const advLabel = document.createElement('p');
            advLabel.style.cssText = 'color:var(--gold);font-size:0.78rem;margin-top:0.3rem;font-style:italic;';
            advLabel.textContent = '⏭ Advanced: ' + match.advanced + ' (no score)';
            matchDiv.appendChild(advLabel);
          }
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
        matchGrid.appendChild(matchDiv);
      });
      roundDiv.appendChild(matchGrid);
      bracketDiv.appendChild(roundDiv);
    });
    // ── Matchmaking settings card above bracket ─────────────────────────────
    if (tournament.status === 'started' || tournament.status === 'completed') {
      const settingsCard = document.createElement('div');
      settingsCard.className = 'rule-card';
      settingsCard.style.cssText = 'margin-bottom:1.25rem;padding:1rem 1.25rem;';
      settingsCard.innerHTML =
        '<h4 style="font-family:Barlow Condensed,sans-serif;text-transform:uppercase;letter-spacing:0.06em;font-size:0.9rem;color:var(--gold);margin:0 0 0.6rem;">⚙️ Match Setup (World of CHEL)</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.3rem 1.5rem;font-size:0.82rem;color:var(--text-muted);">' +
          '<span>Game Type: <strong style="color:var(--text)">Private Game</strong></span>' +
          '<span>Server: <strong style="color:var(--text)">NA‑East</strong></span>' +
          '<span>Period Length: <strong style="color:var(--text)">3 Minutes</strong></span>' +
          '<span>Replay Skipping: <strong style="color:var(--text)">Yes</strong></span>' +
          '<span>Grudge Match: <strong style="color:var(--text)">OFF</strong></span>' +
          '<span>Best Game Location: <strong style="color:var(--text)">Relaxed</strong></span>' +
          '<span>Side Selection: <strong style="color:var(--text)">Highest seed = Home</strong></span>' +
          '<span>Crossplay: <strong style="color:var(--text)">ON (PS5 + Xbox)</strong></span>' +
        '</div>' +
        '<p style="margin:0.6rem 0 0;font-size:0.78rem;color:#ff6b6b;font-weight:600;">⚠️ Lag‑outs = DQ (no exceptions) &nbsp;|&nbsp; No screenshot = no win</p>';
      detail.appendChild(settingsCard);
    }

    // ── Mobile round tabs + Desktop horizontal bracket ──────────────────────
    // Strategy: single bracketDiv used for both.
    // On desktop: shown as horizontal flex via .bracket-wrapper CSS
    // On mobile: tab bar controls which .round is visible; others hidden
    const totalRounds = tournament.bracket.length;

    let activeRoundIndex = totalRounds - 1;
    for (let rr = 0; rr < totalRounds; rr++) {
      const hasUnfinished = tournament.bracket[rr].some(function(m) {
        return m.team1 !== 'BYE' && m.team2 !== 'BYE' && !m.winner;
      });
      if (hasUnfinished) { activeRoundIndex = rr; break; }
    }

    function getRoundLabel(rIdx, total) {
      if (total <= 1) return 'Final';
      if (rIdx === total - 1) return '🏆 Final';
      if (rIdx === total - 2) return 'Semis';
      return 'Round ' + (rIdx + 1);
    }

    // Give each round a data-round attribute for tab targeting
    Array.from(bracketDiv.children).forEach(function(roundDiv, rIdx) {
      roundDiv.dataset.round = rIdx;
      // On mobile, hide all rounds except active one (CSS handles this show/hide)
      roundDiv.classList.add('bracket-round-item');
    });

    // Mobile tab bar
    const mobileTabs = document.createElement('div');
    mobileTabs.className = 'bracket-mobile-tabs';

    tournament.bracket.forEach(function(round, rIdx) {
      const allDone = round.every(function(m) {
        return m.winner || m.team2 === 'BYE' || m.team1 === 'BYE';
      });
      const tabBtn = document.createElement('button');
      tabBtn.className = 'bracket-mobile-tab' + (rIdx === activeRoundIndex ? ' active' : '');
      tabBtn.innerHTML = getRoundLabel(rIdx, totalRounds) +
        (allDone ? ' ✅' : rIdx === activeRoundIndex ? ' <span class="bracket-live-dot"></span>' : '');
      tabBtn.dataset.round = rIdx;
      mobileTabs.appendChild(tabBtn);
    });

    // Set initial mobile visibility
    Array.from(bracketDiv.children).forEach(function(roundDiv) {
      roundDiv.dataset.mobileVisible = parseInt(roundDiv.dataset.round) === activeRoundIndex ? '1' : '0';
    });

    // Tab switching — toggle data-mobile-visible on rounds
    mobileTabs.addEventListener('click', function(e) {
      const btn = e.target.closest('.bracket-mobile-tab');
      if (!btn) return;
      const rIdx = parseInt(btn.dataset.round);
      mobileTabs.querySelectorAll('.bracket-mobile-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      Array.from(bracketDiv.children).forEach(function(roundDiv) {
        roundDiv.dataset.mobileVisible = parseInt(roundDiv.dataset.round) === rIdx ? '1' : '0';
      });
    });

    const bracketWrapper = document.createElement('div');
    bracketWrapper.className = 'bracket-wrapper';
    bracketWrapper.appendChild(bracketDiv);

    detail.appendChild(bracketHeading);
    detail.appendChild(mobileTabs);
    detail.appendChild(bracketWrapper);

    // Init floating chat for players in an active match (non-admin only)
    if (role !== 'admin') {
      initFloatingChat(tournament);
    } else {
      // Admin gets chat bar showing all match chats
      initAdminChatBar(tournament);
    }
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
        renderTournamentDetails(tournament.id);
      });
      adminActions.appendChild(startBtn);
    }
    // ── Check-in controls (free tournaments only, not started) ──
    const entryFeeAdmin = parseFloat(tournament.entry_fee || tournament.entryFee) || 0;
    if (entryFeeAdmin === 0 && tournament.status !== 'started' && tournament.status !== 'completed') {
      if (tournament.status !== 'check_in') {
        // Open check-in button
        const openCIBtn = document.createElement('button');
        openCIBtn.className = 'button';
        openCIBtn.textContent = '✅ Open Check-In';
        openCIBtn.style.cssText = 'background:linear-gradient(135deg,#50c878,#2ecc71);color:#000;font-weight:800;';
        openCIBtn.addEventListener('click', async function() {
          openCIBtn.disabled = true;
          openCIBtn.textContent = 'Opening...';
          await openCheckIn(tournament.id);
          renderTournamentDetails(tournament.id);
        });
        adminActions.appendChild(openCIBtn);
      } else {
        // Check-in is open — show status panel + close button
        const ciPanel = document.createElement('div');
        ciPanel.style.cssText = 'background:rgba(80,200,120,0.08);border:1px solid rgba(80,200,120,0.3);border-radius:var(--radius-md);padding:1rem;margin-bottom:0.75rem;';
        ciPanel.innerHTML = '<p style="color:#50c878;font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:1rem;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 0.5rem;">✅ Check-In Is Open</p>';

        // Load check-in status from Supabase
        (async function() {
          if (!supabaseClient) return;
          try {
            const { data: regs } = await supabaseClient
              .from('tournament_registrations')
              .select('team_id, checked_in, waitlisted')
              .eq('tournament_id', String(tournament.id));

            if (!regs) return;
            const active = regs.filter(function(r) { return !r.waitlisted; });
            const checkedIn = active.filter(function(r) { return r.checked_in; });
            const notCheckedIn = active.filter(function(r) { return !r.checked_in; });
            const waitlisted = regs.filter(function(r) { return r.waitlisted; });

            // Summary
            const summary = document.createElement('p');
            summary.style.cssText = 'font-size:0.88rem;color:var(--text-muted);margin:0 0 0.75rem;';
            summary.textContent = checkedIn.length + ' of ' + active.length + ' teams checked in' + (waitlisted.length > 0 ? ' · ' + waitlisted.length + ' on waitlist' : '');
            ciPanel.appendChild(summary);

            // Get team names from tournament object
            const teamNameMap = {};
            (tournament.teams || []).forEach(function(t) { teamNameMap[String(t.id)] = t.name; });

            // Checked in list
            if (checkedIn.length > 0) {
              const checkedTitle = document.createElement('p');
              checkedTitle.style.cssText = 'font-size:0.78rem;font-weight:700;color:#50c878;margin:0 0 0.3rem;text-transform:uppercase;letter-spacing:0.05em;';
              checkedTitle.textContent = '✅ Checked In';
              ciPanel.appendChild(checkedTitle);
              checkedIn.forEach(function(r) {
                const row = document.createElement('p');
                row.style.cssText = 'font-size:0.85rem;color:var(--text);margin:0 0 0.2rem;padding-left:0.75rem;';
                row.textContent = teamNameMap[String(r.team_id)] || r.team_id;
                ciPanel.appendChild(row);
              });
            }

            // Not checked in list + remove option
            if (notCheckedIn.length > 0) {
              const notTitle = document.createElement('p');
              notTitle.style.cssText = 'font-size:0.78rem;font-weight:700;color:#ff6b6b;margin:0.75rem 0 0.3rem;text-transform:uppercase;letter-spacing:0.05em;';
              notTitle.textContent = '⏳ Not Checked In';
              ciPanel.appendChild(notTitle);
              notCheckedIn.forEach(function(r) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:0.3rem;';
                const nameEl = document.createElement('span');
                nameEl.style.cssText = 'font-size:0.85rem;color:#ff6b6b;padding-left:0.75rem;';
                nameEl.textContent = teamNameMap[String(r.team_id)] || r.team_id;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.style.cssText = 'font-size:0.7rem;padding:0.2rem 0.5rem;background:#8b0000;border:1px solid #cc0000;color:#fff;border-radius:var(--radius-sm);cursor:pointer;';
                removeBtn.addEventListener('click', async function() {
                  if (!confirm('Remove ' + (teamNameMap[String(r.team_id)] || r.team_id) + ' from the tournament?')) return;
                  // Check if waitlist has someone to promote
                  if (waitlisted.length > 0) {
                    const promote = confirm('There are ' + waitlisted.length + ' team(s) on the waitlist. Promote the next team in line?');
                    if (promote) {
                      // Get waitlisted team info
                      const { data: wlData } = await supabaseClient
                        .from('tournament_registrations')
                        .select('team_id')
                        .eq('tournament_id', String(tournament.id))
                        .eq('waitlisted', true)
                        .order('waitlist_position', { ascending: true })
                        .limit(1);
                      if (wlData && wlData.length > 0) {
                        const wlTeamId = wlData[0].team_id;
                        const { data: teamData } = await supabaseClient.from('teams').select('name').eq('id', wlTeamId).single();
                        const wlTeamName = teamData ? teamData.name : wlTeamId;
                        await promoteFromWaitlist(tournament.id, wlTeamId, wlTeamName);
                      }
                    }
                  }
                  // Remove the non-checked-in team
                  await supabaseClient.from('tournament_registrations').delete()
                    .eq('tournament_id', String(tournament.id)).eq('team_id', String(r.team_id));
                  const ts = loadTournaments();
                  const ti = ts.findIndex(function(t) { return String(t.id) === String(tournament.id); });
                  if (ti !== -1) {
                    ts[ti].teams = (ts[ti].teams || []).filter(function(t) { return String(t.id) !== String(r.team_id); });
                    saveTournaments(ts);
                  }
                  renderTournamentDetails(tournament.id);
                });
                row.appendChild(nameEl);
                row.appendChild(removeBtn);
                ciPanel.appendChild(row);
              });
            }

            // Waitlist section
            if (waitlisted.length > 0) {
              const wlTitle = document.createElement('p');
              wlTitle.style.cssText = 'font-size:0.78rem;font-weight:700;color:var(--gold);margin:0.75rem 0 0.3rem;text-transform:uppercase;letter-spacing:0.05em;';
              wlTitle.textContent = '⏳ Waitlist (' + waitlisted.length + ')';
              ciPanel.appendChild(wlTitle);
            }
          } catch(e) { console.error('Check-in panel error:', e); }
        })();

        adminActions.appendChild(ciPanel);

        // Close check-in button
        const closeCIBtn = document.createElement('button');
        closeCIBtn.className = 'button';
        closeCIBtn.textContent = '🔒 Close Check-In';
        closeCIBtn.style.cssText = 'font-size:0.85rem;margin-bottom:0.5rem;';
        closeCIBtn.addEventListener('click', async function() {
          closeCIBtn.disabled = true;
          await closeCheckIn(tournament.id);
          renderTournamentDetails(tournament.id);
        });
        adminActions.appendChild(closeCIBtn);
      }
    }

    // Add Team to Bracket (only when started)
    if (tournament.status === 'started') {
      const addTeamBtn = document.createElement('button');
      addTeamBtn.className = 'button';
      addTeamBtn.textContent = '➕ Add Team to Bracket';
      addTeamBtn.style.cssText = 'font-size:0.85rem;';
      addTeamBtn.addEventListener('click', async function() {
        // Toggle — if panel already open, close it
        const existing = document.getElementById('add-team-panel');
        if (existing) { existing.remove(); return; }

        // Build panel immediately
        const panel = document.createElement('div');
        panel.id = 'add-team-panel';
        panel.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:1.25rem;margin-top:1rem;max-width:480px;';
        panel.innerHTML = '<p style="font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:1rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--gold);margin:0 0 0.75rem;">➕ Add Team to Bracket</p>' +
          '<p style="color:var(--text-muted);font-size:0.85rem;">Loading teams...</p>';
        // Append to detail container so re-renders don't kill it
        detail.appendChild(panel);

        // Load teams
        try {
          let allTeams = [];
          if (supabaseClient) {
            try {
              const { data } = await supabaseClient.from('teams').select('id, name');
              if (data && data.length > 0) allTeams = data;
            } catch(e) {}
          }
          if (allTeams.length === 0) allTeams = loadTeams ? loadTeams() : [];

          // Build bracket slot options — ALL slots in unfinished matches
          const slotOptions = [];
          if (Array.isArray(tournament.bracket)) {
            tournament.bracket.forEach(function(round, rIdx) {
              round.forEach(function(match, mIdx) {
                if (match.winner) return; // skip completed matches
                const roundName = rIdx === tournament.bracket.length - 1 ? 'Final' :
                  rIdx === tournament.bracket.length - 2 ? 'Semis' : 'Round ' + (rIdx + 1);
                slotOptions.push({ label: roundName + ' Match ' + (mIdx+1) + ' — Team 1 (' + (match.team1 || 'empty') + ')', rIdx, mIdx, slot: 'team1', current: match.team1 });
                slotOptions.push({ label: roundName + ' Match ' + (mIdx+1) + ' — Team 2 (' + (match.team2 || 'empty') + ')', rIdx, mIdx, slot: 'team2', current: match.team2 });
              });
            });
          }

          // Rebuild panel content
          panel.innerHTML = '<p style="font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:1rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--gold);margin:0 0 0.75rem;">➕ Add Team to Bracket</p>';

          if (allTeams.length === 0) {
            panel.innerHTML += '<p style="color:var(--text-muted);font-size:0.88rem;">No teams found on this platform.</p>';
          } else if (slotOptions.length === 0) {
            panel.innerHTML += '<p style="color:var(--text-muted);font-size:0.88rem;">No available slots — all matches are completed.</p>';
          } else {
          // Team select
          const teamLabel = document.createElement('p');
          teamLabel.textContent = 'Select team to add:';
          teamLabel.style.cssText = 'font-size:0.82rem;color:var(--text-muted);margin:0 0 0.3rem;';
          const teamSelect = document.createElement('select');
          teamSelect.style.cssText = 'width:100%;margin-bottom:0.75rem;padding:0.45rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.88rem;';
          allTeams.forEach(function(t) {
            const opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = t.name;
            teamSelect.appendChild(opt);
          });

          // Slot select
          const slotLabel = document.createElement('p');
          slotLabel.textContent = 'Place them in slot:';
          slotLabel.style.cssText = 'font-size:0.82rem;color:var(--text-muted);margin:0 0 0.3rem;';
          const slotSelect = document.createElement('select');
          slotSelect.style.cssText = 'width:100%;margin-bottom:0.75rem;padding:0.45rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.88rem;';
          slotOptions.forEach(function(s, i) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = s.label;
            slotSelect.appendChild(opt);
          });

          const confirmBtn = document.createElement('button');
          confirmBtn.className = 'button';
          confirmBtn.textContent = 'Add to Bracket';
          confirmBtn.style.cssText = 'width:100%;margin-top:0.25rem;';
          confirmBtn.addEventListener('click', async function() {
            const teamName = teamSelect.value;
            const slotData = slotOptions[parseInt(slotSelect.value)];
            if (!teamName || !slotData) { alert('Please select a team and slot.'); return; }

            if (!confirm('Add "' + teamName + '" to ' + slotData.label + '?')) return;

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Adding...';

            try {
              // Update bracket directly using tournament object in memory
              const updatedBracket = JSON.parse(JSON.stringify(tournament.bracket));
              updatedBracket[slotData.rIdx][slotData.mIdx][slotData.slot] = teamName;

              // Save to localStorage
              const tournaments2 = loadTournaments();
              const tIdx = tournaments2.findIndex(function(t) { return String(t.id) === String(tournament.id); });
              if (tIdx !== -1) {
                tournaments2[tIdx].bracket = updatedBracket;
                saveTournaments(tournaments2);
              }

              // Register team in Supabase tournament_registrations
              if (supabaseClient) {
                const { data: teamRows } = await supabaseClient.from('teams').select('id').eq('name', teamName).limit(1);
                if (teamRows && teamRows.length > 0) {
                  try {
                    await supabaseClient.from('tournament_registrations').upsert({
                      tournament_id: String(tournament.id),
                      team_id: teamRows[0].id,
                      paid: false,
                    }, { onConflict: 'tournament_id,team_id' });
                  } catch(_) {}
                }

                // Also update bracket in Supabase directly
                await supabaseClient.from('tournaments').update({ bracket: updatedBracket }).eq('id', tournament.id);
              }

              // Sync to backend
              await fetch(API_BASE_URL + '/api/tournaments/' + encodeURIComponent(tournament.id), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bracket: updatedBracket }),
              }).catch(function() {});

              panel.remove();
              renderTournamentDetails(tournament.id);
            } catch(e) {
              console.error('Add team error:', e);
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Add to Bracket';
              alert('Error adding team. Check console for details.');
            }
          });

          panel.appendChild(teamLabel);
          panel.appendChild(teamSelect);
          panel.appendChild(slotLabel);
          panel.appendChild(slotSelect);
          panel.appendChild(confirmBtn);
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'width:100%;background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:var(--radius-sm);padding:0.45rem;cursor:pointer;margin-top:0.5rem;font-size:0.85rem;';
        cancelBtn.addEventListener('click', function() { panel.remove(); addTeamBtn._open = false; });
        panel.appendChild(cancelBtn);
        } catch(err) {
          console.error('Add team panel error:', err);
          panel.innerHTML += '<p style="color:#ff6b6b;font-size:0.85rem;margin-top:0.5rem;">Error loading teams. Please try again.</p>';
        }
      });
      adminActions.appendChild(addTeamBtn);
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

  // ── Live bracket realtime subscription ──────────────────────────────────
  // Subscribe to changes on this specific tournament row.
  // When the bracket or status updates (e.g. admin approves a score),
  // re-render the bracket div in place without a full page reload.
  if (tournament.status === 'started' && supabaseClient) {
    // Clean up any previous subscription for this tournament
    const subKey = 'bracket-live-' + id;
    if (window._bracketSubs && window._bracketSubs[subKey]) {
      try { window._bracketSubs[subKey].unsubscribe(); } catch(e) {}
    }
    if (!window._bracketSubs) window._bracketSubs = {};

    const bracketChannel = supabaseClient
      .channel(subKey)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tournaments',
        filter: 'id=eq.' + id,
      }, async function(payload) {
        if (!payload.new) return;
        const newBracket = Array.isArray(payload.new.bracket)
          ? payload.new.bracket
          : (payload.new.bracket && typeof payload.new.bracket === 'object'
              ? Object.values(payload.new.bracket) : null);
        const newStatus = payload.new.status || null;
        if (!newBracket) return;

        // Update localStorage so local state is consistent
        const localTourneys = loadTournaments();
        const tIdx = localTourneys.findIndex(t => String(t.id) === String(id));
        if (tIdx !== -1) {
          localTourneys[tIdx].bracket = newBracket;
          if (newStatus) localTourneys[tIdx].status = newStatus;
          if (payload.new.winner) localTourneys[tIdx].winner = payload.new.winner;
          saveTournaments(localTourneys);
        }

        // Re-render just the bracket section (not the whole page)
        const existingBracket = container.querySelector('.bracket');
        if (!existingBracket) {
          // Full re-render if bracket section not found
          renderTournamentDetails(id);
          return;
        }

        // Build updated bracket in a temp div, then swap with animation
        const tempDiv = document.createElement('div');
        tempDiv.className = 'bracket';
        newBracket.forEach(function(round, rIndex) {
          const roundDiv = document.createElement('div');
          roundDiv.className = 'round';
          const roundTitle = document.createElement('h4');
          roundTitle.textContent = 'Round ' + (rIndex + 1);
          roundDiv.appendChild(roundTitle);
          round.forEach(function(match) {
            const matchDiv = document.createElement('div');
            matchDiv.className = 'match';
            const matchTitle = document.createElement('p');
            matchTitle.textContent = match.team1 + ' vs. ' + (match.team2 || 'BYE');
            matchDiv.appendChild(matchTitle);
            if (match.winner) {
              const winnerEl = document.createElement('p');
              winnerEl.textContent = 'Winner: ' + match.winner;
              // Flash gold on newly set winners
              const oldRound = tournament.bracket[rIndex];
              const oldMatch = oldRound && oldRound[newBracket[rIndex].indexOf(match)];
              if (!oldMatch || !oldMatch.winner) {
                winnerEl.classList.add('bracket-winner-new');
              }
              matchDiv.appendChild(winnerEl);
            }
            const codeEl = document.createElement('p');
            const role2 = getCurrentUserRole();
            const currentTeam2 = getUserTeam();
            let showCode2 = role2 === 'admin';
            if (!showCode2 && currentTeam2) {
              showCode2 = match.team1 === currentTeam2.name || match.team2 === currentTeam2.name;
            }
            codeEl.textContent = showCode2 ? 'Match code: ' + match.code : 'Match code: (hidden)';
            matchDiv.appendChild(codeEl);
            roundDiv.appendChild(matchDiv);
          });
          tempDiv.appendChild(roundDiv);
        });

        // Swap with fade
        existingBracket.style.opacity = '0';
        existingBracket.style.transition = 'opacity 0.2s';
        setTimeout(function() {
          existingBracket.replaceWith(tempDiv);
          tempDiv.style.opacity = '0';
          tempDiv.style.transition = 'opacity 0.3s';
          requestAnimationFrame(function() {
            tempDiv.style.opacity = '1';
          });
        }, 200);

        // Update local tournament reference for next diff
        tournament.bracket = newBracket;
      })
      .subscribe(function(status) {
        console.log('[Bracket Live] ' + id + ':', status);
      });

    window._bracketSubs[subKey] = bracketChannel;
  }
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