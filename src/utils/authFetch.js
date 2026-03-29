import { auth } from "../firebaseConfig";

/**
 * Wrapper around fetch that automatically attaches the Firebase ID token
 * as a Bearer token in the Authorization header.
 * Use this for all /api/* calls that require authentication.
 */
export async function authFetch(url, options = {}) {
  const user = auth.currentUser;
  const headers = { ...(options.headers || {}) };

  if (user) {
    const token = await user.getIdToken();
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(url, { ...options, headers });
}
