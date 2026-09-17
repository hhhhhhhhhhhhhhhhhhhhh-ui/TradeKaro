// Self-hosted backend: account, watchlist, trade + market extras all live
// in this app under app/api/v1. There is no external backend to point at, so
// this is a constant — the old admin "Backend URL" setting is gone, and with it
// the 60s poll of /api/admin/public that only existed to read it.
export const apiURL = "/api/v1";

export function getApiURL(): string {
  return apiURL;
}
