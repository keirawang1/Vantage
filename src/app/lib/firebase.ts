import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  doc,
  deleteDoc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCgS_BEkwcebJkZqgv7wFpHlQjsENjOXvc",
  authDomain: "vantage-16b9c.firebaseapp.com",
  projectId: "vantage-16b9c",
  storageBucket: "vantage-16b9c.firebasestorage.app",
  messagingSenderId: "85954504081",
  appId: "1:85954504081:web:c4612d9ff3e391c4856630",
  measurementId: "G-K9REL8GFGT",
};

const app = initializeApp(firebaseConfig);
export { app };
export const auth = getAuth(app);
export const db = getFirestore(app);

/** Persisted All-Stocks toolbar + layout prefs */
export interface UserPrefs {
  homeRange: string;
  filter: string;
  sort: string;
  sortDir: string;
  changeDisplay: string;
  viewMode: string;
  theme: string;
  activeWatchlist: string;
  pinnedSymbols: string[];
  /** Manual card order per watchlist id */
  customOrders: Record<string, string[]>;
  /** Last selected chart range per symbol */
  detailRanges: Record<string, string>;
}

export interface UserState {
  balance: number;
  holdings: unknown[];
  transactions: unknown[];
  profile: { name: string; email: string; pic: string };
  setupComplete?: boolean;
  watchlists: unknown[];
  prefs: UserPrefs;
}

export const DEFAULT_PREFS: UserPrefs = {
  homeRange: "1D",
  filter: "all",
  sort: "manual",
  sortDir: "desc",
  changeDisplay: "percent",
  viewMode: "grid",
  theme: "dark",
  activeWatchlist: "portfolio",
  pinnedSymbols: [],
  customOrders: {},
  detailRanges: {},
};

export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signUp(email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  pendingState = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await firebaseSignOut(auth);
}

/** Deletes Firestore user doc then the Auth user. May require recent login. */
export async function deleteAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  pendingState = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    await deleteDoc(doc(db, "users", user.uid));
  } catch (err) {
    console.warn("Failed to delete user doc:", err);
  }
  await deleteUser(user);
}

export function authErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err
    ? String((err as { code: string }).code)
    : "";
  switch (code) {
    case "auth/email-already-in-use":
      return "That email is already registered. Sign in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/requires-recent-login":
      return "Sign out and sign back in, then try deleting again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export async function loadUserState(uid: string): Promise<Partial<UserState> | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as Partial<UserState>) : null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: UserState | null = null;
let pendingUid: string | null = null;

async function flush() {
  const state = pendingState;
  const uid = pendingUid;
  pendingState = null;
  if (!state || !uid) return;
  try {
    await setDoc(
      doc(db, "users", uid),
      { ...state, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.warn("Firestore sync failed:", err);
  }
}

/** Debounced write of the full user state to users/{uid}. */
export function saveUserState(uid: string, state: UserState) {
  pendingUid = uid;
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 800);
}
