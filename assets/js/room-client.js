import { auth, db, ensureSignedIn } from "./firebase.js";
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

function normalizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

function makeRoomCode() {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}

export class RoomClient {
  constructor(gameType) {
    this.gameType = gameType;
    this.user = null;
    this.roomCode = null;
    this.roomRef = null;
    this.role = null;
    this.status = "idle";
    this.unsubscribe = null;
  }

  async initialize() {
    this.user = await ensureSignedIn();
    return this.user;
  }

  async findUnusedRoomCode() {
    for (let i = 0; i < 10; i++) {
      const code = makeRoomCode();
      const snap = await getDoc(doc(db, "rooms", code));
      if (!snap.exists()) return code;
    }
    throw new Error("ルームコードを作成できませんでした。もう一度お試しください。");
  }

  stopListening() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async create(initialState) {
    await this.initialize();
    this.stopListening();

    const code = await this.findUnusedRoomCode();
    const ref = doc(db, "rooms", code);

    await setDoc(ref, {
      version: 2,
      gameType: this.gameType,
      hostUid: this.user.uid,
      guestUid: null,
      status: "waiting",
      state: initialState,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    this.roomCode = code;
    this.roomRef = ref;
    this.role = 1;
    this.status = "waiting";

    return {
      roomCode: code,
      role: 1,
      status: "waiting",
      state: initialState
    };
  }

  async join(rawCode) {
    await this.initialize();

    const code = normalizeRoomCode(rawCode);
    if (code.length !== ROOM_CODE_LENGTH) {
      throw new Error("6文字のルームコードを入力してください。");
    }

    const ref = doc(db, "rooms", code);

    const result = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("そのルームコードの部屋は見つかりません。");

      const data = snap.data();
      if (data.gameType && data.gameType !== this.gameType) {
        throw new Error("このルームコードは別のゲーム用です。");
      }

      if (data.hostUid === this.user.uid) {
        return { role: 1, status: data.status || "waiting", state: data.state };
      }

      if (data.guestUid === this.user.uid) {
        return { role: 2, status: data.status || "playing", state: data.state };
      }

      if (data.guestUid) {
        throw new Error("この部屋にはすでに2人参加しています。");
      }

      transaction.update(ref, {
        guestUid: this.user.uid,
        status: "playing",
        updatedAt: serverTimestamp()
      });

      return { role: 2, status: "playing", state: data.state };
    });

    this.roomCode = code;
    this.roomRef = ref;
    this.role = result.role;
    this.status = result.status;

    return {
      roomCode: code,
      role: result.role,
      status: result.status,
      state: result.state
    };
  }

  listen(onState, onError) {
    if (!this.roomRef) throw new Error("ルームに接続されていません。");

    this.stopListening();
    this.unsubscribe = onSnapshot(
      this.roomRef,
      (snap) => {
        if (!snap.exists()) {
          this.status = "idle";
          onError?.(new Error("この部屋は存在しないか、削除されました。"));
          return;
        }

        const data = snap.data();
        this.status = data.status || "waiting";
        onState?.({
          roomCode: this.roomCode,
          role: this.role,
          status: this.status,
          state: data.state,
          raw: data
        });
      },
      (error) => onError?.(error)
    );

    return this.unsubscribe;
  }

  async updateState(nextState, actorRole, { requireTurn = true, status = null } = {}) {
    if (!this.roomRef || !this.user) throw new Error("オンライン対戦に接続されていません。");

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(this.roomRef);
      if (!snap.exists()) throw new Error("対戦ルームが見つかりません。");

      const data = snap.data();
      const expectedUid = Number(actorRole) === 1 ? data.hostUid : data.guestUid;

      if (expectedUid !== this.user.uid) {
        throw new Error("この操作を行う権限がありません。");
      }

      if (data.status !== "playing" && status !== "finished") {
        throw new Error("対戦はまだ開始されていません。");
      }

      const current = data.state || {};
      if (requireTurn && Number(current.currentPlayer) !== Number(actorRole)) {
        throw new Error("相手のターンです。");
      }

      transaction.update(this.roomRef, {
        state: nextState,
        status: status || (nextState.gameOver ? "finished" : "playing"),
        revision: Number(data.revision || 0) + 1,
        updatedAt: serverTimestamp()
      });
    });
  }

  async resetState(nextState) {
    if (!this.roomRef || !this.user) throw new Error("オンライン対戦に接続されていません。");

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(this.roomRef);
      if (!snap.exists()) throw new Error("対戦ルームが見つかりません。");

      const data = snap.data();
      const participant = data.hostUid === this.user.uid || data.guestUid === this.user.uid;
      if (!participant) throw new Error("この対戦には参加していません。");
      if (!data.guestUid) throw new Error("相手が参加するまで再戦できません。");

      transaction.update(this.roomRef, {
        state: nextState,
        status: "playing",
        revision: Number(data.revision || 0) + 1,
        updatedAt: serverTimestamp()
      });
    });
  }

  async refresh() {
    if (!this.roomRef) return null;
    const snap = await getDoc(this.roomRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    this.status = data.status || this.status;
    return {
      roomCode: this.roomCode,
      role: this.role,
      status: this.status,
      state: data.state,
      raw: data
    };
  }

  leave() {
    this.stopListening();
    this.roomCode = null;
    this.roomRef = null;
    this.role = null;
    this.status = "idle";
  }
}

export { normalizeRoomCode };
