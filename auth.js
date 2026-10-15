/* Supabase 이메일 인증. 앱에서 백엔드를 건드리는 곳은 여기뿐이다.
 *
 * 빌드 단계가 없는 프로젝트라 supabase-js 를 CDN ESM 으로 가져온다.
 * 버전은 고정한다. @2 같은 범위 지정은 어느 날 조용히 깨진다.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Supabase 는 에러 메시지를 영어로 준다. 화면에 그대로 띄우면 안 되니 번역한다.
// 매칭 안 되는 건 원문을 보여준다. 삼켜버리면 디버깅이 불가능해진다.
const MESSAGES = [
  [/invalid login credentials/i,        "이메일 또는 비밀번호가 올바르지 않습니다."],
  [/email not confirmed/i,              "이메일 확인이 아직 안 됐습니다. 받은 메일의 링크를 눌러주세요."],
  [/user already registered|already been registered/i, "이미 가입된 이메일입니다. 로그인해주세요."],
  [/password should be at least (\d+)/i, "비밀번호는 최소 $1자 이상이어야 합니다."],
  [/unable to validate email address/i, "이메일 형식이 올바르지 않습니다."],
  [/email rate limit exceeded|over_email_send_rate_limit/i, "메일 발송 한도를 넘었습니다. 잠시 후 다시 시도해주세요."],
  [/signups not allowed|signup is disabled/i, "현재 가입이 막혀 있습니다."],
  [/failed to fetch|network/i,          "네트워크에 연결할 수 없습니다."],
];

function translate(error) {
  const raw = error?.message ?? String(error);
  for (const [pattern, ko] of MESSAGES) {
    const m = raw.match(pattern);
    if (m) return ko.replace("$1", m[1] ?? "");
  }
  return raw;
}

/** 가입. 프로젝트의 이메일 확인 설정에 따라 결과가 갈린다.
 *  - 확인 OFF: 세션이 바로 생겨서 로그인 상태가 된다       → {ok, needsConfirm:false}
 *  - 확인 ON : 세션 없이 확인 메일만 발송된다              → {ok, needsConfirm:true}
 *  양쪽 다 정상 동작하게 호출부에서 needsConfirm 을 보고 분기한다. */
export async function signUp(email, password, profile = {}) {
  // 닉네임·자기소개는 user_metadata 에 넣는다. 별도 테이블을 만들 수도 있지만
  // 지금은 내 정보 화면에 뿌리는 용도뿐이라 metadata 로 충분하다.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: profile },
  });
  if (error) return { ok: false, message: translate(error) };
  return { ok: true, needsConfirm: !data.session };
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: translate(error) };
  return { ok: true };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return error ? { ok: false, message: translate(error) } : { ok: true };
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(fn) {
  supabase.auth.onAuthStateChange((_event, session) => fn(session));
}
