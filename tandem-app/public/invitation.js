// Invitation secrets live in the URL fragment, which is not sent in HTTP requests.
export const invitationToken = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
export const invitationHeaders = () => invitationToken ? { Authorization: `Bearer ${invitationToken}` } : {};
export function invitationUrl(path, room, token = invitationToken) {
  const url = new URL(path, location.origin);
  url.searchParams.set('room', room);
  if (token) url.hash = new URLSearchParams({ invite: token }).toString();
  return url;
}
