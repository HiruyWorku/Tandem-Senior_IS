import { invitationToken, invitationHeaders, invitationUrl } from '/invitation.js';
const roomDisplay = document.getElementById('roomCodeDisplay');
const status = document.getElementById('invitationStatus');
const copy = document.getElementById('copyLinkBtn');
const retry = document.getElementById('newInvitationBtn');
const links = [document.getElementById('deafLink'), document.getElementById('hearingLink')];
let invitation;
let busy = false;
links.forEach(link => link.addEventListener('click', event => {
  if (link.getAttribute('aria-disabled') === 'true') event.preventDefault();
}));
function lock() {
  invitation = null;
  copy.disabled = true;
  links.forEach(link => { link.setAttribute('aria-disabled', 'true'); link.removeAttribute('href'); });
}
async function prepare(create = false) {
  if (busy) return;
  busy = true;
  lock();
  retry.hidden = true;
  status.textContent = 'Preparing your private invitation…';
  try {
    const room = new URLSearchParams(location.search).get('room');
    if (!create && room && !invitationToken) throw new Error('This link is missing its invitation. Ask your partner for the full link, or start a new session.');
    const existing = !create && Boolean(invitationToken);
    const response = await fetch(existing ? '/api/rooms/validate' : '/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(existing ? invitationHeaders() : {}) },
      body: existing ? JSON.stringify({ room }) : '{}', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Too many invitations. Try again later.');
      if (existing && response.status === 403) throw new Error('This invitation is invalid or expired. Ask your partner for a new link, or start a new session.');
      throw new Error('Unable to prepare your invitation. Check your connection and try again.');
    }
    invitation = await response.json();
    if (existing) invitation.token = invitationToken;
    const url = invitationUrl('/', invitation.room, invitation.token);
    history.replaceState(null, '', url);
    roomDisplay.textContent = invitation.room;
    links.forEach((link, index) => {
      link.href = invitationUrl(index === 0 ? '/deaf.html' : '/hearing.html', invitation.room, invitation.token);
      link.removeAttribute('aria-disabled');
    });
    copy.disabled = false;
    status.textContent = 'Share the full link with your partner. Anyone with it can join; it expires in ' +
      Math.max(1, Math.ceil((invitation.expiresAt * 1000 - Date.now()) / 3600000)) + ' hours.';
  } catch (error) {
    status.textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
      ? 'Unable to prepare your invitation. Check your connection and try again.'
      : error.message || 'Unable to prepare your invitation. Try again.';
    retry.hidden = false;
  } finally { busy = false; }
}
copy.addEventListener('click', async () => {
  if (!invitation) return;
  try {
    await navigator.clipboard.writeText(invitationUrl('/', invitation.room, invitation.token).href);
    status.textContent = 'Link copied. Send it privately to your partner, then choose your role.';
  } catch {
    status.textContent = 'Copy is unavailable. Copy the complete address from your browser, including everything after #.';
  }
});
retry.addEventListener('click', () => prepare(true));
prepare();
