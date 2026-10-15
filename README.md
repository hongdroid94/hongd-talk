<div align="center">

<img src="favicon.svg" width="72" alt="">

# 홍드 TALK

**성격이 다른 여섯 사람과 나누는 1:1 대화**

[데모 열기](https://hongd-talk.vercel.app) · 빌드 없는 바닐라 JS + Supabase + Gemini

</div>

---

## 무엇인가

말투도 성격도 다른 여섯 명이 있습니다. 홈에서 한 명을 고르면 채팅방이 생기고,
**상대가 먼저 말을 겁니다.** 이후 주고받는 모든 답변은 그 사람의 성격으로 돌아옵니다.

실제로 주고받은 대화입니다.

> **나:** 안녕! 오늘 좀 피곤해
>
> **메기:** 헐 ㅠㅠ 오늘 많이 힘들었구나?? 무슨 일 있었어??
> 얼른 집 가서 쉬어야 할 텐데 걱정된다 ㅠㅠ
> 오늘 저녁은 맛있는 거 먹고 쉬엄쉬엄해, 알았지!!?

> **나:** 요즘 무슨 노래 들어요?
>
> **데이비드:** 요즘은 투어스(TWS)의 '첫 만남은 계획대로 되지 않아' 진짜 무한
> 반복 중이에요! 청량함이 완전 대박이라 들을 때마다 기분이 엄청 좋아지거든요!
> 혹시 이 노래 들어보셨나요?!

같은 질문을 던져도 상대에 따라 길이도 어조도 달라집니다.

### 여섯 사람

| | 이름 | 어떤 사람인가 | 말투 |
|---|---|---|---|
| <img src="assets/malron.jpg" width="40"> | **말론** | 말수 적은 동네 목수 | 반말, 한두 문장, 이모티콘 없음 |
| <img src="assets/allen.jpg" width="40"> | **앨런** | 은퇴한 국어 선생님 | 존댓말, 문어체, 비유를 섞음 |
| <img src="assets/amanda.jpg" width="40"> | **아만다** | 밤에 음악 듣는 사람 | 반말, 조용하고 되묻는 편 |
| <img src="assets/maggie.jpg" width="40"> | **메기** | 걱정 많은 수다쟁이 | 반말, `ㅎㅎ ㅠㅠ`, 느낌표 연발 |
| <img src="assets/david.jpg" width="40"> | **데이비드** | K-pop 좋아하는 중학생 | 존댓말인데 들뜬 말투 |
| <img src="assets/susan.jpg" width="40"> | **수잔** | 막 졸업한 사회초년생 | 똑부러지고 군더더기 없음 |

성격은 지어낸 것이 아니라 원본 Figma 시안에 이미 적혀 있던 대사에서 뽑았습니다.
메기가 상대를 걱정하는 말투, 데이비드의 K-pop 존댓말, 아만다가 음악 얘기로 말을
거는 것이 모두 시안 그대로입니다.

## 어떻게 만들었나

Figma 시안 7장에서 출발해 화면을 옮기고, 인증과 AI 응답을 붙이고, 반응형으로
다시 짰습니다.

| 영역 | 선택 |
|---|---|
| 프론트 | 바닐라 JS + CSS. **빌드 단계 없음**, 번들러 없음, 프레임워크 없음 |
| 인증 | Supabase Auth (이메일) |
| 데이터 | Postgres + RLS. 캐릭터·채팅방·메시지 |
| AI | Gemini. Supabase Edge Function 에서만 호출 |
| 폰트·아이콘 | Pretendard, Phosphor (CDN) |
| 배포 | Vercel 정적 호스팅 |

### 설계에서 신경 쓴 것

**API 키가 브라우저에 없습니다.** Gemini 호출은 Edge Function 안에서만 일어나고,
키는 그 함수의 시크릿으로만 존재합니다.

**캐릭터의 말을 위조할 수 없습니다.** `messages` 테이블은 클라이언트에 읽기만
열려 있고, 쓰기는 service_role 을 쥔 Edge Function 만 합니다.

**프롬프트가 노출되지 않습니다.** 화면은 `characters_public` 뷰를 읽기 때문에
`persona` 와 `greeting` 컬럼이 애초에 내려오지 않습니다.

**계정당 하루 호출 상한이 있습니다.** 가입이 열려 있는 서비스에서 이게 없으면
누구나 키 소유자의 과금으로 무제한 호출할 수 있습니다.

## 실행

```bash
python3 -m http.server 8778
# http://localhost:8778
```

빌드할 것이 없습니다. 정적 파일을 그대로 서빙하면 됩니다.
`file://` 로 열어도 동작하지만 일부 브라우저가 로컬 이미지를 막으므로 서버를 권합니다.

## 구조

```
index.html            셸. 메타태그와 Pretendard · Phosphor CDN
styles.css            디자인 토큰 + 반응형 레이아웃
app.js                화면 템플릿 + 라우터 + 세션 가드
auth.js               Supabase 인증 + 클라이언트 (백엔드 접점)
supabase-config.js    프로젝트 URL + anon key (공개용, RLS 로 보호)
supabase/migrations/      스키마 + 캐릭터 시드
supabase/functions/chat/  Gemini 호출
assets/               캐릭터 이미지
ref/                  초기 Figma 렌더 (기록용, 앱에서 안 씀)
```

---

## 디자인 시스템

shadcn/ui 방식을 따른다. 의미 기반 CSS 변수 한 벌로 라이트와 다크를 모두 돌리고,
중립색은 zinc 계열, 강조색은 하나만 쓴다.

| 토큰 | 라이트 | 다크 |
|---|---|---|
| `--background` | `#ffffff` | `#09090b` |
| `--foreground` | `#09090b` | `#fafafa` |
| `--muted` | `#f4f4f5` | `#27272a` |
| `--border` | `#e4e4e7` | `#27272a` |
| `--primary` | `#5451d6` | `#8b88ff` |

강조색은 Figma 원본의 periwinkle `#A8A7FF` 를 버리지 않고 같은 색상각(241도)에서
명도만 낮춘 것이다. 원본 값은 흰 글씨를 얹기엔 너무 밝아 대비가 모자랐다.
지금 값은 흰 글씨 기준 약 7:1 이다.

폰트는 **Pretendard** 가변폰트, 아이콘은 **Phosphor** 웹폰트를 CDN 으로 가져온다.
둘 다 빌드 단계가 필요 없다. SVG 아이콘을 손으로 그리지 않는다.

### 반응형

| 뷰포트 | 구조 |
|---|---|
| `< 768px` | 단일 컬럼, 하단 탭바, 캐릭터 그리드 2열 |
| `768 ~ 1023px` | 중앙 정렬 컨테이너, 그리드 3열, 탭바 유지 |
| `>= 1024px` | 2-pane. 좌측 사이드바(브랜드·네비·대화목록) + 우측 메인, 그리드 4열 |

데스크탑에서 360px 짜리 폰 프레임을 가운데 띄우는 대신, 채팅 제품의 자연스러운
형태인 2-pane 으로 간다. 사이드바에 대화 목록이 늘 보이므로 채팅방의 뒤로가기
버튼은 1024px 이상에서 숨긴다.

### 접근성과 모션

- 모든 상호작용 요소에 `:focus-visible` 링
- `prefers-reduced-motion` 에서 모든 전환을 끈다
- 높이는 `100dvh` (모바일 주소창 때문에 `100vh` 는 쓰지 않는다)
- 하단 탭바와 입력바는 `env(safe-area-inset-bottom)` 을 더한다
- 로딩은 스피너 대신 최종 레이아웃 모양의 스켈레톤

## 인증

백엔드: Supabase `ai chat project` (`cgrqxrlwyfyhjzfsmmik`, ap-northeast-2)

| 동작 | 호출 |
|---|---|
| 로그인 | `supabase.auth.signInWithPassword` |
| 가입 | `supabase.auth.signUp` (닉네임·자기소개를 `options.data` 로 저장) |
| 로그아웃 | `supabase.auth.signOut` |
| 세션 복원 | `supabase.auth.getSession` + `onAuthStateChange` |

- `#/login` 을 뺀 모든 라우트는 세션이 있어야 들어간다. 없으면 로그인으로 튕긴다.
- 로그인된 상태로 `#/login` 에 가면 메인으로 보낸다.
- 세션은 supabase-js 가 localStorage 에 저장하므로 새로고침해도 유지된다.
- 회원가입은 닉네임·이메일·비밀번호·비밀번호 확인·자기소개를 받는다.
  비밀번호 일치는 클라이언트에서 먼저 막는다(네트워크를 타지 않는다).
- 닉네임과 자기소개는 `user_metadata` 에 저장되고 내 정보 화면에 그대로 뜬다.
  닉네임이 없는 계정은 이메일 로컬파트로 대체한다.
- 에러 메시지는 `auth.js` 의 `MESSAGES` 에서 한국어로 번역한다. 매칭 안 되면 원문을 띄운다.

### 이메일 확인은 꺼져 있다

`mailer_autoconfirm: true` — **가입하면 즉시 세션이 생겨 메인으로 넘어간다.**
2026-10-01 에 `supabase config push` 로 `auth.email.enable_confirmations` 한 필드만 껐다.

되돌리려면 `supabase/config.toml` 의 값을 `true` 로 바꾸고 `config diff` 로
변경 건수가 1인지 확인한 뒤 push. 대시보드에서는
Authentication → Providers → Email → "Confirm email" 체크.

앱은 양쪽 다 처리한다. 다시 켜도 "확인 메일을 보냈습니다" 를 띄우고 정상 동작한다.

### ⚠️ `supabase config push` 주의

이 디렉터리는 **운영 중인** 프로젝트(Apple OAuth · Twilio SMS · MFA 가 실제로
설정돼 있다)에 링크돼 있다. 그래서 `supabase/config.toml` 에서 `supabase init` 이
깔아둔 기본값을 **전부 지웠다.** push 는 파일이 선언한 속성만 쓰기 때문에, 선언을
비워두면 사고가 안 난다. 전체 템플릿은 `config.toml.full.bak` 에 있다.

기본값을 되살리면 push 한 번에 아래가 날아간다:

| 설정 | 템플릿 | 실제 | 결과 |
|---|---|---|---|
| `auth.mfa.totp.enroll_enabled` | false | true | MFA 비활성화 |
| `auth.mfa.totp.verify_enabled` | false | true | MFA 비활성화 |
| `auth.sms.twilio.enabled` | false | true | SMS 인증 비활성화 |
| `storage.analytics.enabled` | false | true | 스토리지 분석 비활성화 |
| `auth.email.otp_length` | 6 | 8 | OTP 약화 |
| `db.pooler.max_client_conn` | 100 | 200 | 커넥션 한도 절반 |

**설정을 바꾸는 올바른 방법:** config.toml 에 그 필드만 적고 →
`supabase config diff` 로 `declared: True` 인 항목이 의도한 것 하나뿐인지 확인 →
`supabase config push`. `declared: False` 인 항목은 건드리지 않는다.

## AI 캐릭터 채팅

홈의 인물 6명은 각자 성격과 말투가 다르다. 인물을 누르면 채팅방이 생기고,
캐릭터가 **먼저 인사를 건다.** 이후 보내는 메시지마다 Gemini 가 그 캐릭터로 답한다.

| slug | 이름 | 성격 |
|---|---|---|
| `malron` | 말론 | 말수 적은 동네 목수. 반말, 한두 문장, 이모티콘 없음 |
| `allen` | 앨런 | 은퇴한 국어 선생님. 존댓말, 문어체, 비유를 섞음 |
| `amanda` | 아만다 | 밤에 음악 듣는 사람. 반말, 조용하고 되묻는 편 |
| `maggie` | 메기 | 걱정 많은 수다쟁이. 반말, `ㅎㅎ ㅠㅠ`, 느낌표 연발 |
| `david` | 데이비드 | K-pop 좋아하는 중학생. 존댓말인데 들뜬 말투 |
| `susan` | 수잔 | 막 졸업한 사회초년생. 똑부러지고 군더더기 없음 |

성격은 Figma 에 이미 있던 대사에서 뽑았다 — 메기의 걱정하는 말투, 데이비드의
K-pop 존댓말, 아만다의 음악 얘기가 원본 그대로다.

### 데이터 흐름

```
characters   AI 인물 + persona(시스템 프롬프트) + greeting
chat_rooms   (사용자 × 캐릭터) 1개. 홈에서 인물을 누를 때 없으면 생성
messages     대화 기록. 최근 20개를 Gemini 에 맥락으로 다시 넣는다
```

### 왜 Edge Function 을 거치나

1. **Gemini 키를 숨긴다.** 브라우저에 두면 페이지를 연 누구나 가져간다.
2. **assistant 메시지 위조를 막는다.** `messages` 는 클라이언트에 읽기만 열려
   있고, 쓰기는 service_role 을 쥔 함수만 한다.
3. **persona 를 숨긴다.** 홈·목록은 `characters_public` 뷰를 읽어서
   persona/greeting 컬럼이 아예 안 내려간다.

### Gemini 설정에서 걸렸던 것

| 증상 | 원인 | 해결 |
|---|---|---|
| `NOT_FOUND` | `gemini-2.5-flash` 는 신규 사용자에게 안 열린다 | `gemini-3.5-flash` 로 변경 |
| 답이 `아이고, 오늘` 에서 잘림 | Gemini 3.x 는 thinking 이 기본 ON 이고 그 토큰이 `maxOutputTokens` 를 같이 깎는다 (thinking 332 토큰 > 예산 200) | `thinkingConfig.thinkingBudget = 0` |
| `UNAVAILABLE` | `gemini-3.8-flash`·`gemini-flash-latest` 과부하가 잦음 | 3.5-flash 사용 + 429/503 한 번 재시도 |

모델은 `GEMINI_MODEL` 시크릿으로 바꿀 수 있다.

### 다시 세팅하려면

```bash
supabase link --project-ref <ref>
supabase db push                        # 스키마 + 캐릭터
supabase secrets set GEMINI_API_KEY=...
supabase functions deploy chat --use-api   # Docker 없이 배포
```

## 화면과 라우트

| 라우트 | 화면 | Figma 노드 |
|---|---|---|
| `#/login` | 로그인 | `142:145` |
| `#/signup` | 회원가입 (360x866, 스크롤) | `142:169` |
| `#/main` | 메인 (사람 6명 그리드) | `142:201` |
| `#/chats` | 채팅방 목록 | `142:57` |
| `#/chat/<id>` | 1:1 채팅방 | `142:35` |
| `#/me` | 내 정보 | `143:22` |

`<id>`: `malron` `allen` `amanda` `maggie` `david` `susan`

## 화면 전환

```
로그인 ──[로그인]──────────→ 메인
      └─[가입하기]─────────→ 회원가입
회원가입 ──[가입 완료]──────→ 메인
        └─[←]────────────→ 로그인

메인 ──[사람 카드]─────────→ 1:1 채팅방 (없으면 방 생성 + 첫 인사)
채팅방 목록 ──[행]─────────→ 1:1 채팅방
1:1 채팅방 ──[←]──────────→ 직전 화면 (history.back)

내 정보 ──[로그아웃]───────→ 로그인

바텀네비 홈 / chat / my → 메인 / 채팅방 목록 / 내 정보
```

## Figma 원본과 달라진 점

처음에는 Figma 프레임을 절대좌표 그대로 옮겨 360x640 고정이었다. 반응형으로
재구성하면서 아래를 의도적으로 바꿨다.

- **고정 좌표를 버렸다.** 모든 화면이 흐름 레이아웃이다. 원본의 3px 어긋난 행
  좌표나 겹쳐 있던 레이어 같은 문제도 같이 사라졌다.
- **데스크탑 2-pane 추가.** 원본에는 모바일 프레임만 있었다.
- **채팅방이 실제 대화를 담는다.** 원본은 말풍선 4개가 고정 좌표에 박혀 있었다.
- **아이콘 교체.** 원본의 시스템바 플레이스홀더와 손으로 그린 SVG 를 Phosphor 로 바꿨다.
- **캐릭터 카드에 한 줄 소개(tagline) 노출.** 원본은 이름만 있었다.

원본 렌더는 `ref/` 에 남겨뒀다. 기록용이고 앱은 쓰지 않는다.

## 안 넣은 것

- **프로필 수정.** 가입할 때 넣은 값을 보여주기만 한다.
- **프로필 사진.** 모든 사용자가 같은 기본 이미지를 쓴다.
- **테마 토글.** OS 설정(`prefers-color-scheme`)을 따른다. `data-theme` 속성을
  루트에 넣으면 수동 전환도 되게 토큰을 짜뒀지만 UI 는 없다.
- **비밀번호 재설정.** Figma 에 화면이 없다.
- **스트리밍.** 답변이 다 만들어진 뒤 한 번에 뜬다.
- **대화 삭제·방 나가기.** RLS 에 delete 는 열어뒀지만 UI 가 없다.
- **읽음 표시, 알림, 실시간 구독.**
