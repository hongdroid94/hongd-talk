/* 홍드 TALK 채팅 백엔드.
 *
 * Gemini 키를 브라우저에 두면 페이지를 연 누구나 가져갈 수 있다. 그래서 키는
 * Edge Function 시크릿에만 두고, 프론트는 이 함수만 호출한다.
 *
 * assistant 메시지 쓰기도 여기서만 한다(messages 테이블은 클라이언트에 읽기만
 * 열려 있다). 그래야 캐릭터가 한 말을 사용자가 위조할 수 없다.
 *
 * action:
 *   "open" { characterSlug } → 방을 찾거나 만든다. 새로 만들었으면 첫 인사를 넣는다.
 *   "send" { roomId, text }  → 사용자 메시지 저장 → Gemini 호출 → 답변 저장
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
// gemini-2.5-flash 는 신규 사용자에게 더 이상 열리지 않는다(NOT_FOUND).
// 3.8/flash-latest 는 과부하(UNAVAILABLE)가 잦아 3.5-flash 를 기본으로 둔다.
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash";

// 맥락으로 되돌려 넣을 최근 메시지 수. 길어질수록 토큰값이 올라간다.
const HISTORY_LIMIT = 20;

// 계정당 하루 Gemini 호출 상한.
// 가입이 열려 있고 이메일 확인도 꺼져 있어서, 이게 없으면 아무나 계정을 만들어
// 키 소유자의 과금으로 무제한 호출할 수 있다. AI_DAILY_CAP 으로 조절한다.
const DAILY_CAP = Number(Deno.env.get("AI_DAILY_CAP") ?? "100");

// supabase-js 의 functions.invoke 는 authorization 말고도 apikey 와 x-client-info 를
// 같이 보낸다. 이걸 빼먹으면 브라우저 preflight 가 막혀서 요청이 아예 안 나가고,
// 클라이언트에는 "Failed to send a request to the Edge Function" 만 뜬다.
// curl 로는 preflight 가 없어 재현되지 않으니 주의.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function askGemini(persona: string, history: { role: string; content: string }[]) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY 가 설정되지 않았습니다.");

  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: persona }] },
    // Gemini 는 assistant 를 "model" 이라고 부른다.
    contents: history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 400,
      // Gemini 3.x 는 thinking 이 기본으로 켜져 있고 그 토큰이 maxOutputTokens 를
      // 같이 깎는다. 켜두면 400 토큰을 사고로 다 써서 답이 한두 글자에서 잘린다
      // (finishReason=MAX_TOKENS). 짧은 채팅 답변에는 추론이 필요 없으니 끈다.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const call = () => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: payload,
    },
  );

  // 429/503(과부하)은 자주 뜨고 대개 금방 풀린다. 한 번만 더 시도한다.
  let res = await call();
  if (res.status === 429 || res.status === 503) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await call();
  }

  if (!res.ok) {
    const detail = await res.text();
    let msg = `Gemini ${res.status}`;
    try { msg = JSON.parse(detail)?.error?.message ?? msg; } catch { /* 본문이 JSON 이 아님 */ }
    throw new Error(msg.slice(0, 200));
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();

  // 안전필터 등으로 본문이 비어 돌아오는 경우가 있다. 빈 말풍선을 띄우지 않는다.
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini 가 빈 응답을 돌려줬습니다 (finishReason: ${reason})`);
  }
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "로그인이 필요합니다." }, 401);

    // 호출자가 누구인지는 사용자 토큰으로 확인한다.
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();

    /* ── 방 열기 ──────────────────────────────────────────── */
    if (body.action === "open") {
      const { data: character, error: cErr } = await admin
        .from("characters")
        .select("id, slug, name, avatar, greeting")
        .eq("slug", body.characterSlug)
        .single();
      if (cErr || !character) return json({ error: "없는 캐릭터입니다." }, 404);

      const { data: existing } = await admin
        .from("chat_rooms")
        .select("id")
        .eq("user_id", user.id)
        .eq("character_id", character.id)
        .maybeSingle();

      if (existing) return json({ roomId: existing.id, created: false });

      const { data: room, error: rErr } = await admin
        .from("chat_rooms")
        .insert({ user_id: user.id, character_id: character.id })
        .select("id")
        .single();
      if (rErr) return json({ error: rErr.message }, 500);

      // 입장하면 캐릭터가 먼저 말을 건다. 매번 생성하면 느리고 돈이 드니
      // DB 에 저장해둔 인사말을 그대로 쓴다.
      await admin.from("messages").insert({
        room_id: room.id,
        role: "assistant",
        content: character.greeting,
      });

      return json({ roomId: room.id, created: true });
    }

    /* ── 메시지 보내기 ────────────────────────────────────── */
    if (body.action === "send") {
      const text = (body.text ?? "").trim();
      if (!text) return json({ error: "빈 메시지는 보낼 수 없습니다." }, 400);
      if (text.length > 2000) return json({ error: "메시지가 너무 깁니다." }, 400);

      // 남의 방에 쓰지 못하게 소유권을 확인한다.
      const { data: room } = await admin
        .from("chat_rooms")
        .select("id, user_id, characters(persona)")
        .eq("id", body.roomId)
        .maybeSingle();
      if (!room || room.user_id !== user.id) {
        return json({ error: "없는 채팅방입니다." }, 404);
      }

      // 사용자 메시지를 저장하기 전에 상한을 본다. 넘었으면 아무것도 쓰지 않는다.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await admin
        .from("messages")
        .select("id, chat_rooms!inner(user_id)", { count: "exact", head: true })
        .eq("role", "assistant")
        .eq("chat_rooms.user_id", user.id)
        .gte("created_at", since);

      if ((count ?? 0) >= DAILY_CAP) {
        return json({
          error: `하루 대화 한도(${DAILY_CAP}회)를 다 썼습니다. 내일 다시 이용해주세요.`,
        }, 429);
      }

      await admin.from("messages").insert({
        room_id: room.id, role: "user", content: text,
      });

      const { data: history } = await admin
        .from("messages")
        .select("role, content")
        .eq("room_id", room.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);

      const ordered = (history ?? []).reverse();
      // 캐릭터 인사말이 맨 앞이면 Gemini 가 user 턴으로 시작하길 기대해 어색해진다.
      while (ordered.length && ordered[0].role === "assistant") ordered.shift();

      // deno-lint-ignore no-explicit-any
      const persona = (room as any).characters?.persona as string;
      const reply = await askGemini(persona, ordered);

      await admin.from("messages").insert({
        room_id: room.id, role: "assistant", content: reply,
      });

      return json({ reply });
    }

    return json({ error: "알 수 없는 action 입니다." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
