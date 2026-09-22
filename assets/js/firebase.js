import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyANxan7PahEmVwgPFUvbBwovGyr2zAXS_A",
  authDomain: "first-project-509404.firebaseapp.com",
  projectId: "first-project-509404",
  storageBucket: "first-project-509404.firebasestorage.app",
  messagingSenderId: "74701616267",
  appId: "1:74701616267:web:c30c082abc1fa88993908e"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export async function ensureSignedIn() {
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}
