// Google sign-in through Firebase Auth (GCP project vada-so). These are public client values.
// The SDK loads only when a sign-in page needs it, so it stays out of the main bundle.
const config = {
  apiKey: 'AIzaSyC3D0mF7MaaJPzLK62SVEgUjiwCfgZsTjo',
  authDomain: 'vada-so.firebaseapp.com',
  projectId: 'vada-so',
  appId: '1:179120992848:web:20688da35a7c98e6ec9755',
};

let loading = null;
function load() {
  loading ??= Promise.all([import('firebase/app'), import('firebase/auth')]).then(([app, auth]) => ({
    auth: auth.getAuth(app.getApps()[0] || app.initializeApp(config)),
    sdk: auth,
  }));
  return loading;
}

// Start loading early (on the login page) so the popup opens inside the click's user activation.
export const preloadGoogle = () => (__MOCK__ ? Promise.resolve() : load().catch(() => {}));

// The local mock can't talk to Google: hand it an unsigned token it understands.
function mockToken() {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64({ sub: 'mock-google-1', email: 'google.demo@example.com', name: 'Google Demo', email_verified: true })}.`;
}

// Opens Google sign-in and returns a Firebase ID token. Returns null when the page is navigating
// away to Google instead (popup blocked); redirectIdToken() picks the result up on return.
export async function googleIdToken() {
  if (__MOCK__) return mockToken();
  const { auth, sdk } = await load();
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const cred = await sdk.signInWithPopup(auth, provider);
    return await cred.user.getIdToken();
  } catch (err) {
    if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
      await sdk.signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function redirectIdToken() {
  if (__MOCK__) return null;
  const { auth, sdk } = await load();
  const res = await sdk.getRedirectResult(auth);
  return res?.user ? res.user.getIdToken() : null;
}

// Firebase error codes in words. Null means the person simply closed the window.
export function googleError(err) {
  switch (err?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return null;
    case 'auth/network-request-failed':
      return "Couldn't reach Google. Check your connection and try again.";
    case 'auth/unauthorized-domain':
      return "Google sign-in isn't enabled for this address.";
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a minute and try again.';
    default:
      return 'Google sign-in did not finish. Try again, or use email and password.';
  }
}
