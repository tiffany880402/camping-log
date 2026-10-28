import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, where, limit, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';

const config = window.FIREBASE_CONFIG || {};
export const configured = !!config.apiKey && !String(config.apiKey).startsWith('PASTE_');

let auth, fs;
if (configured) {
  const app = initializeApp(config);
  auth = getAuth(app);
  auth.languageCode = 'zh-TW';
  // Offline cache: lists still open at camp with no signal; edits sync when back online.
  const opts = { ignoreUndefinedProperties: true };
  try {
    fs = initializeFirestore(app, { ...opts, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    fs = initializeFirestore(app, opts);
  }
}

/* ---------- auth ---------- */
export function watchAuth(cb) {
  if (!configured) { cb(null); return () => {}; }
  getRedirectResult(auth).catch((e) => console.warn('redirect sign-in', e));
  return onAuthStateChanged(auth, cb);
}
// Always sign in with a popup. A redirect returns through the Firebase auth domain, which is a
// different site from github.io; iPhones (especially home-screen apps) block that hand-off and the
// app keeps showing the sign-in page. Popups are not affected.
export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (!standalone && e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
export const logOut = () => signOut(auth);

/* ---------- path-based Firestore wrapper (same shape the app code expects) ---------- */
const wrapSnap = (s) => ({ id: s.id, exists: s.exists(), data: () => s.data() });
const wrapQS = (s) => ({ empty: s.empty, size: s.size, docs: s.docs.map((d) => ({ id: d.id, exists: true, data: () => d.data() })) });
function wrapDoc(ref) {
  return {
    id: ref.id, path: ref.path,
    get: () => getDoc(ref).then(wrapSnap),
    set: (d, opts) => setDoc(ref, d, opts || {}),
    update: (d) => updateDoc(ref, d),
    delete: () => deleteDoc(ref),
    onSnapshot: (next, err) => onSnapshot(ref, (s) => next(wrapSnap(s)), err),
  };
}
function wrapQuery(q, colRef) {
  const w = {
    where: (f, op, v) => wrapQuery(query(q, where(f, op, v))),
    limit: (n) => wrapQuery(query(q, limit(n))),
    get: () => getDocs(q).then(wrapQS),
    onSnapshot: (next, err) => onSnapshot(q, (s) => next(wrapQS(s)), err),
  };
  if (colRef) w.doc = (id) => wrapDoc(doc(colRef, id));
  return w;
}
export const db = {
  doc: (path) => wrapDoc(doc(fs, path)),
  collection: (path) => { const c = collection(fs, path); return wrapQuery(c, c); },
};
