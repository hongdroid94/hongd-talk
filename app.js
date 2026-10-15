/* 홍드 TALK - 라우터 + 화면.
 *
 * 레이아웃은 세 단계로 갈린다 (styles.css 참고):
 *   < 768px   단일 컬럼 + 하단 탭바
 *   768-1023  중앙 정렬 컨테이너, 그리드 열 증가
 *   >= 1024   좌측 사이드바(브랜드·네비·대화목록) + 우측 메인 2-pane
 *
 * 라우트: #/login  #/signup  #/main  #/chats  #/chat/<slug>  #/me
 * #/login, #/signup 을 뺀 나머지는 세션이 있어야 들어간다.
 *
 * 캐릭터·대화는 Supabase 에 있고, Gemini 호출과 assistant 메시지 쓰기는
 * Edge Function 에서만 한다. 자세한 건 README.
 */
import {
  supabase, signIn, signUp, signOut, getSession, onAuthChange,
} from "./auth.js";

const DEFAULT_BIO = "아직 자기소개를 적지 않았습니다.";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Phosphor 는 굵기 클래스(ph / ph-fill)와 이름 클래스를 따로 받는다.
// 이름 클래스는 굵기와 무관하게 항상 `ph-<name>` 이다.
//   regular -> .ph.ph-paper-plane-tilt
//   fill    -> .ph-fill.ph-paper-plane-tilt
// 여기서 `ph-fill-paper-plane-tilt` 처럼 굵기를 이름에 붙이면 글리프가 사라진다.
// DB 의 characters.avatar 는 "assets/malron.png" 로 저장돼 있다. 배포하면서 이미지를
// 512px JPEG 로 줄이는 바람에 확장자가 달라졌는데, 지금 supabase CLI 가 이 프로젝트를
// 소유한 계정으로 로그인돼 있지 않아 DB 값을 고칠 수 없다.
// 접근이 복구되면 characters.avatar 를 .jpg 로 바꾸고 이 함수를 지우면 된다.
const avatarURL = (p) => String(p ?? "").replace(/\.png$/, ".jpg");

const icon = (name, weight = "ph") => `<i class="i ${weight} ph-${name}" aria-hidden="true"></i>`;

/* ── 상태 ───────────────────────────────────────────── */

let session = null;
let characters = [];
let bySlug = {};
let rooms = [];
let currentRoomId = null;

async function loadCharacters() {
  if (characters.length) return characters;
  const { data, error } = await supabase
    .from("characters_public").select("*").order("sort_order");
  if (error) throw error;
  characters = data ?? [];
  bySlug = Object.fromEntries(characters.map((c) => [c.slug, c]));
  return characters;
}

// 목록 + 각 방의 마지막 메시지. 마지막 메시지는 한 번에 긁어 와서 추린다.
async function loadRooms() {
  const { data, error } = await supabase
    .from("chat_rooms")
    .select("id, last_message_at, characters(slug, name, avatar)")
    .order("last_message_at", { ascending: false });
  if (error) throw error;

  rooms = data ?? [];
  if (!rooms.length) return rooms;

  const { data: msgs } = await supabase
    .from("messages")
    .select("room_id, content, created_at")
    .in("room_id", rooms.map((r) => r.id))
    .order("created_at", { ascending: false });

  const lastOf = {};
  for (const m of msgs ?? []) if (!(m.room_id in lastOf)) lastOf[m.room_id] = m.content;
  rooms = rooms.map((r) => ({ ...r, last: lastOf[r.id] ?? "" }));
  return rooms;
}

const loadMessages = async (roomId) => {
  const { data, error } = await supabase
    .from("messages").select("role, content")
    .eq("room_id", roomId).order("created_at");
  if (error) throw error;
  return data ?? [];
};

const callChat = async (body) => {
  const { data, error } = await supabase.functions.invoke("chat", { body });
  // 함수가 4xx/5xx 를 주면 invoke 는 error 만 채우고 본문을 버린다.
  // 본문의 한국어 메시지를 살려야 사용자에게 쓸모 있는 말을 띄울 수 있다.
  if (error) {
    let detail = error.message;
    try { detail = (await error.context?.json())?.error ?? detail; } catch { /* 본문 없음 */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

const nicknameOf = (user) =>
  user?.user_metadata?.nickname || user?.email?.split("@")[0] || "";

/* ── 셸 ─────────────────────────────────────────────── */

const NAV = [
  { route: "#/main", label: "홈", icon: "house" },
  { route: "#/chats", label: "채팅", icon: "chat-circle" },
  { route: "#/me", label: "내 정보", icon: "user" },
];

const tabbar = (active) => `
  <nav class="tabbar" aria-label="주요 메뉴">
    ${NAV.map((n) => `
      <button data-go="${n.route}" ${active === n.route ? 'aria-current="page"' : ""}>
        ${icon(n.icon, active === n.route ? "ph-fill" : "ph")}
        <span>${n.label}</span>
      </button>`).join("")}
  </nav>`;

const YEAR = new Date().getFullYear();
const footer = (cls = "app-footer") =>
  `<footer class="${cls}"><small>\u00a9 ${YEAR} 홍드로이드</small></footer>`;

const roomRow = (r, { current = false, compact = false } = {}) => `
  <button class="room-row" data-open="${esc(r.characters.slug)}" aria-current="${current}">
    <img class="avatar${compact ? " sm" : ""}" src="${esc(avatarURL(r.characters.avatar))}" alt="">
    <span class="body">
      <span class="name">${esc(r.characters.name)}</span>
      <span class="last">${esc(r.last || "대화를 시작해보세요")}</span>
    </span>
  </button>`;

// 사이드바는 1024px 이상에서만 보인다. 모바일에선 하단 탭바가 같은 일을 한다.
const sidebar = (active, activeSlug) => `
  <aside class="sidebar">
    <div class="brand-row">
      <span class="mark">${icon("chats-teardrop", "ph-fill")}</span>
      <strong>홍드 TALK</strong>
    </div>
    <div class="nav">
      ${NAV.map((n) => `
        <button data-go="${n.route}" ${active === n.route ? 'aria-current="page"' : ""}>
          ${icon(n.icon, active === n.route ? "ph-fill" : "ph")}
          <span>${n.label}</span>
        </button>`).join("")}
    </div>
    <div class="divider"></div>
    <div class="list-label">대화 중</div>
    <div class="rooms">
      ${rooms.length
        ? rooms.map((r) => roomRow(r, { current: r.characters.slug === activeSlug, compact: true })).join("")
        : `<p class="list-label" style="font-weight:400">아직 없습니다.</p>`}
    </div>
    ${footer("sidebar-footer")}
  </aside>`;

/** 인증된 화면의 공통 뼈대. */
const shell = ({ active, activeSlug = null, title, subtitle = "", lead = "", flush = false, body }) => `
  <div class="shell">
    ${sidebar(active, activeSlug)}
    <div class="main has-tabbar">
      <header class="topbar">
        ${lead}
        <h1>${esc(title)}${subtitle ? ` <span class="sub">${esc(subtitle)}</span>` : ""}</h1>
      </header>
      <div class="content${flush ? " flush" : ""}">${body}${flush ? "" : footer()}</div>
    </div>
    ${tabbar(active)}
  </div>`;

/* ── 화면 ───────────────────────────────────────────── */

const screens = {
  login: () => `
    <div class="auth">
      <div class="auth-card">
        <div class="brand">
          <span class="mark">${icon("chats-teardrop", "ph-fill")}</span>
          <h1>홍드 TALK</h1>
          <p>마음에 드는 상대를 골라 대화를 시작하세요.</p>
        </div>
        <form class="auth-fields" id="signin-form">
          <div class="field">
            <label for="email">이메일</label>
            <input class="input" id="email" name="email" type="email"
                   autocomplete="username" placeholder="you@example.com">
          </div>
          <div class="field">
            <label for="password">비밀번호</label>
            <input class="input" id="password" name="password" type="password"
                   autocomplete="current-password" placeholder="6자 이상">
          </div>
          <div class="auth-actions">
            <button class="btn btn-primary btn-block" type="submit">로그인</button>
            <div class="msg"></div>
          </div>
        </form>
        <p class="auth-foot">
          처음이신가요? <button type="button" data-go="#/signup">가입하기</button>
        </p>
        ${footer("auth-footer")}
      </div>
    </div>`,

  signup: () => `
    <div class="auth">
      <div class="auth-card wide">
        <div class="brand">
          <h1>가입하기</h1>
          <p>닉네임과 자기소개는 내 정보 화면에 표시됩니다.</p>
        </div>
        <form class="auth-fields" id="signup-form">
          <div class="field">
            <label for="nickname">닉네임</label>
            <input class="input" id="nickname" name="nickname" placeholder="홍드로이드">
          </div>
          <div class="field">
            <label for="email">이메일</label>
            <input class="input" id="email" name="email" type="email"
                   autocomplete="username" placeholder="you@example.com">
          </div>
          <div class="field">
            <label for="password">비밀번호</label>
            <input class="input" id="password" name="password" type="password"
                   autocomplete="new-password">
            <span class="hint">6자 이상 입력하세요.</span>
          </div>
          <div class="field">
            <label for="password2">비밀번호 확인</label>
            <input class="input" id="password2" name="password2" type="password"
                   autocomplete="new-password">
          </div>
          <div class="field">
            <label for="bio">자기 소개</label>
            <textarea class="input" id="bio" name="bio"
                      placeholder="어떤 사람인지 한두 줄로 적어주세요."></textarea>
          </div>
          <div class="auth-actions">
            <button class="btn btn-primary btn-block" type="submit">가입 완료</button>
            <div class="msg"></div>
          </div>
        </form>
        <p class="auth-foot">
          이미 계정이 있으신가요? <button type="button" data-go="#/login">로그인</button>
        </p>
        ${footer("auth-footer")}
      </div>
    </div>`,

  main: (list) => shell({
    active: "#/main",
    title: "홈",
    body: `
      <div class="page-head">
        <h2>오늘은 누구와 이야기할까요</h2>
        <p>여섯 명 모두 성격과 말투가 다릅니다. 누르면 바로 대화가 시작됩니다.</p>
      </div>
      <div class="grid">
        ${list.length ? list.map((c) => `
          <button class="person" data-open="${esc(c.slug)}">
            <img src="${esc(avatarURL(c.avatar))}" alt="${esc(c.name)}" loading="lazy">
            <span class="name">${esc(c.name)}</span>
            <span class="tagline">${esc(c.tagline)}</span>
          </button>`).join("")
        : Array.from({ length: 6 }, () => `
          <div class="person" aria-hidden="true">
            <div class="skel" style="aspect-ratio:1"></div>
            <div class="skel" style="height:1rem;width:40%"></div>
            <div class="skel" style="height:2rem"></div>
          </div>`).join("")}
      </div>`,
  }),

  chats: (list, loading) => shell({
    active: "#/chats",
    title: "채팅",
    body: list.length
      ? `<div class="rooms">${list.map((r) => roomRow(r)).join("")}</div>`
      : loading
        ? `<div class="rooms">${Array.from({ length: 3 }, () =>
            `<div class="skel" style="height:4.5rem"></div>`).join("")}</div>`
        : `<div class="empty">
             ${icon("chat-circle-dots")}
             <p>아직 나눈 대화가 없습니다.\n홈에서 마음에 드는 상대를 골라보세요.</p>
             <button class="btn btn-outline" data-go="#/main">홈으로 가기</button>
           </div>`,
  }),

  room: (character, body) => shell({
    active: "#/chats",
    activeSlug: character?.slug ?? null,
    title: character?.name ?? "",
    subtitle: character?.tagline ?? "",
    flush: true,
    lead: `<button class="icon-btn back-btn" data-back aria-label="뒤로">${icon("arrow-left")}</button>
           <img class="avatar sm" src="${esc(avatarURL(character?.avatar))}" alt="">`,
    body: `
      <div class="thread" id="thread">${body}</div>
      <div class="composer">
        <form id="composer-form">
          <textarea class="input" id="composer-input" rows="1"
                    placeholder="메시지를 입력하세요" disabled></textarea>
          <button class="btn btn-primary send" type="submit" aria-label="보내기" disabled>
            ${icon("paper-plane-tilt", "ph-fill")}
          </button>
        </form>
      </div>`,
  }),

  me: (user) => shell({
    active: "#/me",
    title: "내 정보",
    body: `
      <div class="profile">
        <img class="avatar lg" src="assets/hongdroid.jpg" alt="">
        <div class="who">
          <span class="nick">${esc(nicknameOf(user))}</span>
          <span class="mail">${esc(user?.email ?? "")}</span>
        </div>
      </div>
      <div class="section">
        <h3>자기 소개</h3>
        <div class="panel">${esc(user?.user_metadata?.bio || DEFAULT_BIO)}</div>
      </div>
      <div class="section">
        <button class="btn btn-outline" data-action="signout">
          ${icon("sign-out")}<span>로그아웃</span>
        </button>
      </div>`,
  }),
};

const turnHTML = (m, avatar) => m.role === "assistant"
  ? `<div class="turn them"><img class="avatar sm" src="${esc(avatarURL(avatar))}" alt="">
       <div class="bubble">${esc(m.content)}</div></div>`
  : `<div class="turn me"><div class="bubble">${esc(m.content)}</div></div>`;

/* ── 라우터 ─────────────────────────────────────────── */

const app = document.getElementById("app");
const PUBLIC_ROUTES = ["#/login", "#/signup"];

async function render() {
  const hash = location.hash || "#/login";
  const chat = hash.match(/^#\/chat\/([\w-]+)$/);
  const isPublic = PUBLIC_ROUTES.includes(hash);

  // 목적지가 현재 해시와 같을 때 넘기면 hashchange 가 안 떠서 빈 화면이 된다.
  let target = null;
  if (!isPublic && !session) target = "#/login";
  else if (isPublic && session) target = "#/main";
  if (target && target !== hash) { location.hash = target; return; }

  if (hash === "#/signup") return void (app.innerHTML = screens.signup());
  if (!session) return void (app.innerHTML = screens.login());

  // 사이드바가 대화 목록을 쓰므로 인증 화면 어디서든 미리 채워둔다.
  loadRooms()
    .then(() => refreshSidebar(chat?.[1] ?? null))
    .catch(() => {});

  if (hash === "#/me") return void (app.innerHTML = screens.me(session.user));
  if (chat) return renderRoom(chat[1]);
  if (hash === "#/chats") return renderChats();
  return renderMain();
}

async function renderMain() {
  app.innerHTML = screens.main(characters);
  try {
    const list = await loadCharacters();
    if (location.hash === "#/main" || !location.hash) app.innerHTML = screens.main(list);
  } catch (e) {
    console.error(e);
  }
}

async function renderChats() {
  app.innerHTML = screens.chats(rooms, true);
  try {
    const list = await loadRooms();
    if (location.hash === "#/chats") app.innerHTML = screens.chats(list, false);
  } catch (e) {
    app.innerHTML = screens.chats([], false);
    console.error(e);
  }
}

async function renderRoom(slug) {
  await loadCharacters().catch(() => {});
  const character = bySlug[slug];
  currentRoomId = null;

  app.innerHTML = screens.room(character, `<div class="notice">대화를 불러오는 중입니다</div>`);

  try {
    const { roomId } = await callChat({ action: "open", characterSlug: slug });
    if (location.hash !== `#/chat/${slug}`) return;   // 기다리는 동안 다른 화면으로 갔다
    currentRoomId = roomId;
    paintThread(await loadMessages(roomId), character?.avatar);
    setComposerEnabled(true);
    loadRooms().then(() => {
      if (location.hash === `#/chat/${slug}`) refreshSidebar(slug);
    });
  } catch (e) {
    setNotice(`대화를 열지 못했습니다.\n${e.message}`, true);
  }
}

/* ── 채팅방 조작 ────────────────────────────────────── */

const threadEl = () => document.getElementById("thread");

function scrollToEnd() {
  const t = threadEl();
  if (t) t.scrollTop = t.scrollHeight;
}

function paintThread(messages, avatar) {
  const t = threadEl();
  if (!t) return;
  t.innerHTML = messages.map((m) => turnHTML(m, avatar)).join("");
  scrollToEnd();
}

function setNotice(text, isError = false, html = null) {
  const t = threadEl();
  if (!t) return;
  clearNotice();
  t.insertAdjacentHTML("beforeend",
    `<div class="notice${isError ? " error" : ""}" data-notice>${html ?? esc(text)}</div>`);
  scrollToEnd();
}

const clearNotice = () => t_removeAll("[data-notice]");
const t_removeAll = (sel) => threadEl()?.querySelectorAll(sel).forEach((el) => el.remove());

function setComposerEnabled(on) {
  const input = document.getElementById("composer-input");
  const send = document.querySelector(".composer .send");
  if (input) { input.disabled = !on; if (on && window.innerWidth >= 1024) input.focus(); }
  if (send) send.disabled = !on;
}

// 사이드바만 다시 그린다. 메시지를 보낼 때마다 전체를 새로 그리면 스크롤이 튄다.
function refreshSidebar(activeSlug = null) {
  const old = document.querySelector(".sidebar");
  if (!old) return;
  const hash = location.hash || "#/main";
  const active = hash.startsWith("#/chat/") ? "#/chats" : hash;
  const wrap = document.createElement("div");
  wrap.innerHTML = sidebar(active, activeSlug);
  old.replaceWith(wrap.firstElementChild);
}

async function sendMessage() {
  const input = document.getElementById("composer-input");
  const text = input?.value.trim();
  if (!text || !currentRoomId) return;

  const slug = location.hash.split("/").pop();
  const character = bySlug[slug];
  input.value = "";
  input.style.height = "";
  setComposerEnabled(false);
  clearNotice();

  // 보낸 말은 바로 띄운다. 답을 기다리는 동안 화면이 멈춰 있으면 안 된다.
  threadEl()?.insertAdjacentHTML("beforeend", turnHTML({ role: "user", content: text }));
  scrollToEnd();
  setNotice(null, false,
    `${esc(character?.name ?? "")} 입력 중 <span class="typing"><i></i><i></i><i></i></span>`);

  try {
    const { reply } = await callChat({ action: "send", roomId: currentRoomId, text });
    clearNotice();
    threadEl()?.insertAdjacentHTML("beforeend",
      turnHTML({ role: "assistant", content: reply }, character?.avatar));
    scrollToEnd();
    loadRooms().then(() => refreshSidebar(slug));
  } catch (e) {
    setNotice(`답변을 받지 못했습니다.\n${e.message}`, true);
  } finally {
    setComposerEnabled(true);
  }
}

/* ── 로그인 / 가입 ──────────────────────────────────── */

const say = (text, tone = "error") => {
  const el = app.querySelector(".msg");
  if (el) { el.textContent = text; el.className = `msg ${tone}`; }
};

async function lockWhile(form, pending, run) {
  const buttons = form.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  say(pending, "info");
  const result = await run();
  buttons.forEach((b) => (b.disabled = false));
  return result;
}

async function doSignIn(form) {
  const v = (n) => form.elements[n]?.value ?? "";
  const email = v("email").trim();
  const password = v("password");
  if (!email || !password) return say("이메일과 비밀번호를 입력해주세요.");

  const result = await lockWhile(form, "로그인 중입니다", () => signIn(email, password));
  if (!result.ok) say(result.message);
}

async function doSignUp(form) {
  const v = (n) => form.elements[n]?.value ?? "";
  const nickname = v("nickname").trim();
  const email = v("email").trim();
  const password = v("password");
  const bio = v("bio").trim();

  if (!nickname || !email || !password) {
    return say("닉네임, 이메일, 비밀번호는 필수입니다.");
  }
  if (password !== v("password2")) return say("비밀번호가 서로 다릅니다.");

  const result = await lockWhile(form, "가입 중입니다",
    () => signUp(email, password, { nickname, bio }));
  if (!result.ok) return say(result.message);
  if (result.needsConfirm) {
    say("확인 메일을 보냈습니다.\n링크를 누른 뒤 로그인해주세요.", "info");
  }
}

/* ── 이벤트 ─────────────────────────────────────────── */

app.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "signin-form") return doSignIn(e.target);
  if (e.target.id === "signup-form") return doSignUp(e.target);
  if (e.target.id === "composer-form") return sendMessage();
});

app.addEventListener("click", async (e) => {
  const go = e.target.closest("[data-go]");
  if (go) { location.hash = go.dataset.go; return; }

  // 홈 카드와 대화 목록 행은 둘 다 "그 캐릭터와의 방으로" 라는 같은 동작이다.
  const open = e.target.closest("[data-open]");
  if (open) { location.hash = `#/chat/${open.dataset.open}`; return; }

  if (e.target.closest("[data-action='signout']")) {
    characters = []; bySlug = {}; rooms = []; currentRoomId = null;
    const r = await signOut();
    if (!r.ok) say(r.message);
    return;
  }

  if (e.target.closest("[data-back]")) {
    if (history.length > 1) history.back();
    else location.hash = "#/chats";
  }
});

app.addEventListener("keydown", (e) => {
  // 엔터로 보내고, 줄바꿈은 Shift+Enter. 모바일 키보드에선 전송 버튼을 쓴다.
  if (e.key === "Enter" && !e.shiftKey && e.target.id === "composer-input") {
    e.preventDefault();
    sendMessage();
  }
});

// 입력창이 내용에 맞춰 늘어난다. max-height 는 CSS 가 잡는다.
app.addEventListener("input", (e) => {
  if (e.target.id !== "composer-input") return;
  e.target.style.height = "auto";
  e.target.style.height = `${e.target.scrollHeight}px`;
});

addEventListener("hashchange", render);

// 첫 렌더 전에 세션을 확인해야 새로고침 때 로그인 화면이 깜빡이지 않는다.
(async function boot() {
  session = await getSession();
  onAuthChange((s) => { session = s; render(); });
  render();
})();
