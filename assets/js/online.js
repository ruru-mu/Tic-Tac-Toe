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

let user = null;
let currentRoomCode = null;
let currentRoomRef = null;
let currentRole = null;
let currentStatus = "idle";
let unsubscribeRoom = null;

const els = {
  localMode: document.getElementById("local-mode-btn"),
  onlineMode: document.getElementById("online-mode-btn"),
  onlineControls: document.getElementById("online-controls"),
  createRoom: document.getElementById("create-room-btn"),
  joinRoom: document.getElementById("join-room-btn"),
  roomInput: document.getElementById("room-code-input"),
  roomState: document.getElementById("room-state"),
  roomCode: document.getElementById("current-room-code"),
  roomStatus: document.getElementById("room-status-text"),
  copyRoom: document.getElementById("copy-room-code-btn"),
  onlineFeedback: document.getElementById("online-feedback")
};

function setFeedback(text = "", isError = false) {
  if (!els.onlineFeedback) return;
  els.onlineFeedback.textContent = text;
  els.onlineFeedback.classList.toggle("error", Boolean(isError));
}

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

function setBusy(busy) {
  if (els.createRoom) els.createRoom.disabled = busy;
  if (els.joinRoom) els.joinRoom.disabled = busy;
  if (els.roomInput) els.roomInput.disabled = busy;
}

function updateModeUi(mode) {
  const online = mode === "online";
  els.localMode?.classList.toggle("active", !online);
  els.onlineMode?.classList.toggle("active", online);
  if (els.onlineControls) els.onlineControls.hidden = !online;
}

function updateRoomUi({ roomCode = currentRoomCode, role = currentRole, status = currentStatus } = {}) {
  currentRoomCode = roomCode || null;
  currentRole = role || null;
  currentStatus = status || "idle";

  if (!els.roomState) return;

  const hasRoom = Boolean(currentRoomCode);
  els.roomState.hidden = !hasRoom;
  if (!hasRoom) return;

  if (els.roomCode) els.roomCode.textContent = currentRoomCode;

  let statusText = "";
  if (status === "waiting") {
    statusText = `あなたは ${role === "○" ? "○" : "×"}。相手を待っています…`;
  } else if (status === "playing") {
    statusText = `あなたは ${role === "○" ? "○" : "×"}。対戦中です。`;
  } else if (status === "finished") {
    statusText = `あなたは ${role === "○" ? "○" : "×"}。対戦が終了しました。`;
  } else {
    statusText = "オンライン対戦";
  }
  if (els.roomStatus) els.roomStatus.textContent = statusText;
}

function notifyGameSession() {
  window.CheatGame?.setOnlineSession?.({
    roomCode: currentRoomCode,
    role: currentRole,
    status: currentStatus
  });
}

async function initialize() {
  try {
    setFeedback("通信の準備中…");
    user = await ensureSignedIn();
    setFeedback("");
    return user;
  } catch (error) {
    console.error("Firebase anonymous sign-in failed:", error);
    setFeedback("通信の準備に失敗しました。ページを再読み込みしてください。", true);
    throw error;
  }
}

async function findUnusedRoomCode() {
  for (let i = 0; i < 8; i++) {
    const code = makeRoomCode();
    const snapshot = await getDoc(doc(db, "rooms", code));
    if (!snapshot.exists()) return code;
  }
  throw new Error("ルームコードを作成できませんでした。もう一度お試しください。");
}

function stopListening() {
  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }
}

function listenToRoom(roomCode, role) {
  stopListening();

  currentRoomCode = roomCode;
  currentRole = role;
  currentRoomRef = doc(db, "rooms", roomCode);

  unsubscribeRoom = onSnapshot(
    currentRoomRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        currentStatus = "idle";
        updateRoomUi({ roomCode: null, role: null, status: "idle" });
        notifyGameSession();
        setFeedback("この部屋は存在しないか、削除されました。", true);
        return;
      }

      const data = snapshot.data();
      currentStatus = data.status || "waiting";
      updateRoomUi();
      notifyGameSession();
      window.CheatGame?.applyRemoteState?.(data);
    },
    (error) => {
      console.error("Room listener failed:", error);
      setFeedback("対戦データの受信に失敗しました。", true);
    }
  );
}

async function createRoom() {
  await initialize();
  setBusy(true);
  setFeedback("");

  try {
    stopListening();

    const roomCode = await findUnusedRoomCode();
    const roomRef = doc(db, "rooms", roomCode);
    const initial = window.CheatGame?.getBlankState?.();

    if (!initial) throw new Error("ゲームの初期状態を取得できません。");

    await setDoc(roomRef, {
      version: 1,
      hostUid: user.uid,
      guestUid: null,
      status: "waiting",
      board: initial.board,
      overwriteCount: initial.overwriteCount,
      currentPlayer: initial.currentPlayer,
      gameOver: false,
      winner: null,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    currentRoomRef = roomRef;
    updateRoomUi({ roomCode, role: "○", status: "waiting" });
    notifyGameSession();
    listenToRoom(roomCode, "○");
    setFeedback("部屋を作成しました。ルームコードを相手に送ってください。");
  } catch (error) {
    console.error("Create room failed:", error);
    setFeedback(error?.message || "部屋の作成に失敗しました。", true);
  } finally {
    setBusy(false);
  }
}

async function joinRoom() {
  await initialize();

  const roomCode = normalizeRoomCode(els.roomInput?.value);
  if (roomCode.length !== ROOM_CODE_LENGTH) {
    setFeedback("6文字のルームコードを入力してください。", true);
    return;
  }

  setBusy(true);
  setFeedback("");

  try {
    const roomRef = doc(db, "rooms", roomCode);

    const role = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) {
        throw new Error("そのルームコードの部屋は見つかりません。");
      }

      const data = snapshot.data();

      if (data.hostUid === user.uid) {
        return "○";
      }

      if (data.guestUid === user.uid) {
        return "×";
      }

      if (data.guestUid) {
        throw new Error("この部屋にはすでに2人参加しています。");
      }

      transaction.update(roomRef, {
        guestUid: user.uid,
        status: "playing",
        updatedAt: serverTimestamp()
      });

      return "×";
    });

    currentRoomRef = roomRef;
    updateRoomUi({ roomCode, role, status: role === "○" ? "waiting" : "playing" });
    notifyGameSession();
    listenToRoom(roomCode, role);
    setFeedback(role === "○" ? "自分の部屋に戻りました。" : "部屋に参加しました。");
  } catch (error) {
    console.error("Join room failed:", error);
    setFeedback(error?.message || "部屋への参加に失敗しました。", true);
  } finally {
    setBusy(false);
  }
}

function canAct(playerMark) {
  return Boolean(
    currentRoomRef &&
    currentStatus === "playing" &&
    currentRole === playerMark
  );
}

async function pushState(state, actorMark) {
  if (!currentRoomRef || !user) throw new Error("オンライン対戦に接続されていません。");
  if (!actorMark) throw new Error("操作プレイヤーを確認できません。");

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(currentRoomRef);
    if (!snapshot.exists()) throw new Error("対戦ルームが見つかりません。");

    const data = snapshot.data();
    const expectedUid = actorMark === "○" ? data.hostUid : data.guestUid;

    if (expectedUid !== user.uid) {
      throw new Error("今はあなたの操作ではありません。");
    }

    if (data.status !== "playing") {
      throw new Error("対戦はまだ開始されていません。");
    }

    if (data.currentPlayer !== actorMark) {
      throw new Error("相手のターンです。");
    }

    transaction.update(currentRoomRef, {
      board: state.board,
      overwriteCount: state.overwriteCount,
      currentPlayer: state.currentPlayer,
      gameOver: Boolean(state.gameOver),
      winner: state.winner || null,
      status: state.gameOver ? "finished" : "playing",
      revision: Number(data.revision || 0) + 1,
      updatedAt: serverTimestamp()
    });
  });
}

async function resetRoom(state) {
  if (!currentRoomRef || !user) throw new Error("オンライン対戦に接続されていません。");

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(currentRoomRef);
    if (!snapshot.exists()) throw new Error("対戦ルームが見つかりません。");

    const data = snapshot.data();
    const isParticipant = data.hostUid === user.uid || data.guestUid === user.uid;
    if (!isParticipant) throw new Error("この対戦には参加していません。");
    if (!data.guestUid) throw new Error("相手が参加するまでリセットできません。");

    transaction.update(currentRoomRef, {
      board: state.board,
      overwriteCount: state.overwriteCount,
      currentPlayer: "○",
      gameOver: false,
      winner: null,
      status: "playing",
      revision: Number(data.revision || 0) + 1,
      updatedAt: serverTimestamp()
    });
  });
}


async function refreshRoom() {
  if (!currentRoomRef) return;

  try {
    const snapshot = await getDoc(currentRoomRef);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    currentStatus = data.status || currentStatus;
    updateRoomUi();
    notifyGameSession();
    window.CheatGame?.applyRemoteState?.(data);
  } catch (error) {
    console.error("Room refresh failed:", error);
  }
}

function leaveRoom() {
  stopListening();
  currentRoomCode = null;
  currentRoomRef = null;
  currentRole = null;
  currentStatus = "idle";
  updateRoomUi({ roomCode: null, role: null, status: "idle" });
  notifyGameSession();
  setFeedback("");
}

async function copyRoomCode() {
  if (!currentRoomCode) return;
  try {
    await navigator.clipboard.writeText(currentRoomCode);
    setFeedback("ルームコードをコピーしました。");
  } catch {
    setFeedback(`ルームコード: ${currentRoomCode}`);
  }
}

function selectMode(mode) {
  updateModeUi(mode);
  window.CheatGame?.setMode?.(mode);

  if (mode === "online") {
    initialize().catch(() => {});
  } else {
    leaveRoom();
  }
}

els.localMode?.addEventListener("click", () => selectMode("local"));
els.onlineMode?.addEventListener("click", () => selectMode("online"));
els.createRoom?.addEventListener("click", createRoom);
els.joinRoom?.addEventListener("click", joinRoom);
els.copyRoom?.addEventListener("click", copyRoomCode);
els.roomInput?.addEventListener("input", () => {
  els.roomInput.value = normalizeRoomCode(els.roomInput.value);
});
els.roomInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRoom();
});

window.addEventListener("beforeunload", stopListening);

window.OnlineTicTacToe = {
  initialize,
  createRoom,
  joinRoom,
  leaveRoom,
  canAct,
  pushState,
  resetRoom,
  refreshRoom,
  getSession() {
    return {
      uid: auth.currentUser?.uid || null,
      roomCode: currentRoomCode,
      role: currentRole,
      status: currentStatus
    };
  }
};

updateModeUi("local");
