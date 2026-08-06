# ⚙️ Dynamis Web Platform - 경남과학고등학교 학술 동아리 웹 플랫폼

<div align="center">
  <br>

  <p align="center">
    <strong>"공학적인 원리를 깨닫고 이를 활용하여 깊은 생각과 탐구를 통해 답을 찾고자 하는 집단"</strong>
  </p>

 (https://img.shields.io/badge/Language-HTML5%20%2F%20CSS3%20%2F%20Vanilla%20JS-F05340?style=flat-square)](https://github.com)
 ![Vite](https://img.shields.io/badge/Bundler-Vite-646CFF?style=flat-square&logo=vite)
 ![Firebase](https://img.shields.io/badge/Database-Firebase%20Firestore-FFCA28?style=flat-square&logo=firebase)
 ![App Check](https://img.shields.io/badge/Security-App%20Check%20reCAPTCHA%20v3-4285F4?style=flat-square&logo=google)
 ![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)
</div>

---

## 💡 동아리 정체성 및 비전 (Identity & Vision)

**디나미스(Dynamis)**는 경남과학고등학교 제42기 때 결성된 학술 소통의 중심지입니다. 우리는 단순한 이론의 주입식 습득을 거부하며, 수학과 기계공학의 유기적인 결합을 기반으로 실질적인 문제 해결 과정을 탐구하고 이를 웹 기술을 통해 안전한 플랫폼으로 실현합니다.

---

## 🛠️ 핵심 기능 (Core Features)

1. **정적 SPA 라우팅:** `vercel.json`의 rewrite가 모든 경로를 `index.html`로 넘겨주므로, `/notice` 같은 하위 경로에서 새로고침해도 화면이 파손되지 않습니다. (GitHub Pages 시절 쓰던 `404.html` 리다이렉트 우회는 Vercel로 옮기면서 불필요해져 제거했습니다.)
2. **홈 실시간 현황 대시보드:** 부원 수·누적 공지·진행 중 이벤트·등록된 질문을 카운트업 애니메이션으로 보여주고, 최근 공지·마감 임박 이벤트·최신 질문을 미리보기로 노출합니다. 각 항목은 이미 구독 중인 데이터를 재사용할 뿐이라 추가 Firestore 읽기가 발생하지 않습니다.
3. **통합 검색 (⌘K / Ctrl+K):** 공지·이벤트·FAQ·부원·페이지를 한 화면에서 검색하는 커맨드 팔레트입니다. 검색어 하이라이트와 키보드 내비게이션(↑↓/Enter/Esc)을 지원하며, 역시 로컬 메모리 상의 데이터만 조회합니다.
4. **서버 강제 일일 트래픽 한도:** Firestore 보안 규칙이 `getAfter()`로 "본문 쓰기와 카운터 증가가 같은 배치에서 정확히 일어났는지"를 검증하여, 클라이언트가 카운터 증가만 생략해 한도를 우회하는 경로를 원천 차단합니다. 부원별 일일 공지 5회·이벤트 5회·댓글 10회·FAQ 질문 1회·첨부파일 업로드 2MB로 제한됩니다.
5. **다계층 첨부파일 방어:** 파일당 크기 상한과 첨부 합계 용량 상한을 클라이언트·서버 양쪽에서 검증하고, 다운로드 시 `data:` 스킴 화이트리스트로 저장형 XSS를 차단합니다. 관리자 계정도 예외 없이 적용됩니다.
6. **이벤트(행사) 관리 및 시계 오차 감지:** 마감 기한을 지정하면 실시간 카운트다운이 표시되고, 마감 후에는 서버가 `request.time` 기준으로 열람을 최종 차단합니다. 기기와 서버 시계가 어긋나면 경고 배너로 안내합니다.
7. **부원 소개 및 좋아요:** 이름·기수·등급·소개글은 로그인 없이도 열람할 수 있도록 공개 프로필(`memberProfiles`)로 분리되어 있으며, 경고 이력·로그인 아이디 등 민감 정보가 담긴 원본 계정 문서(`users`)는 본인과 관리자만 읽을 수 있습니다. 아직 승인되지 않은 계정은 공개 프로필이 생성되지 않아 명부에 노출되지 않습니다. 공지·이벤트·FAQ·부원 소개에는 좋아요(하트) 위젯이 붙습니다.
8. **안 읽은 글 표시:** 마지막 방문 시각을 브라우저에만 저장해 새로 올라온 글에 NEW 표시와 네비게이션 카운트 뱃지를 띄웁니다. 서버로 나가는 요청은 없습니다.
9. **관리자 콘솔:** 등급 변경·경고 부여·강제 탈퇴를 지원합니다. 실제 쓰기 권한은 보안 규칙이 요청자 본인의 `users/{uid}` 문서를 직접 읽어 `role` 필드로 판정하므로, 등급 변경은 화면 표시가 아니라 **서버 권한 자체**를 바꾸는 조치입니다(자세한 내용은 `관리자 계정 가이드.md`).
10. **App Check & Google reCAPTCHA v3 연동:** 외부 비인가 프로그램(Python Request, cURL 등)을 통한 Firestore 데이터베이스 위변조 및 탈취 행위를 Google 보안 서버 인증 토큰을 통해 원천 무력화합니다.
11. **연쇄적 개인정보 파기 영구 삭제:** 대한민국 개인정보보호법에 준거하여 사용자가 '탈퇴' 시 본인의 계정은 물론 그동안 작성했던 공지사항·이벤트·댓글·공개 프로필을 일괄 배치(Batch)로 흔적 없이 삭제 처리합니다.

---

## 📂 디렉토리 구조 (Directory Structure)

```
Dynamis-Web-Platform/
├── public/
│   ├── logo.png                  # 동아리 공식 심벌 로고
│   ├── figure1.png               # 수학 및 기계공학 학술 도해
│   ├── figure2.png               # 기계공학 메커니즘 도해
│   └── .nojekyll                 # GitHub Pages의 Jekyll 정적 빌드 필터링 무력화 파일
├── src/
│   ├── partials/                 # index.html이 <!-- include: ... --> 로 불러오는 섹션별 HTML 조각
│   │   ├── header.html / mobile-nav.html / footer.html
│   │   ├── home.html, home-dashboard.html      # 홈 소개 + 실시간 현황 대시보드
│   │   ├── notice.html, notice-modal.html      # 공지사항
│   │   ├── event.html, event-modal.html        # 이벤트(행사) + 마감 타이머
│   │   ├── faq.html, faq-modal.html            # FAQ
│   │   ├── members.html                        # 부원 소개
│   │   ├── login.html, signup.html, signup-preview-modal.html, mypage.html
│   │   ├── admin.html                          # 관리자 콘솔
│   │   ├── search-modal.html                   # 통합 검색(⌘K) 팔레트
│   │   ├── privacy.html, guidelines.html
│   │   └── orb-init-script.html
│   ├── css/
│   │   ├── style.css             # partials/*.css를 불러 모으는 진입점
│   │   └── partials/             # 레이아웃/컴포넌트별로 분리된 스타일시트
│   └── js/
│       ├── app.js                # 진입점 — 모듈 초기화 및 인라인 핸들러용 전역(window) 바인딩
│       ├── firebase-config.js    # Firebase SDK 초기화 및 App Check(Google reCAPTCHA v3) 연동
│       ├── router.js             # SPA 라우팅 및 로그인 조건부 리다이렉트
│       ├── state.js              # 로그인 세션 상태(live binding)
│       ├── session.js            # 로그인 상태 변화에 따른 화면 전반 UI 갱신
│       ├── auth.js               # Google/GitHub 로그인, 회원가입, 연쇄 탈퇴
│       ├── notice.js / event.js / faq.js / members.js / admin.js  # 각 탭 기능
│       ├── traffic.js            # 일일 트래픽 카운터 (서버 규칙과 짝을 이루는 배치 쓰기)
│       ├── likes.js              # 좋아요(하트) 위젯 (공지/이벤트/FAQ/부원 공용)
│       ├── clock.js              # 기기-서버 시계 오차 측정 및 경고 배너
│       ├── dashboard.js          # 홈 실시간 현황 대시보드
│       ├── search.js             # 통합 검색(⌘K / Ctrl+K) 커맨드 팔레트
│       ├── unread.js             # 마지막 방문 이후 새 글 NEW 표시 (로컬 저장, 서버 요청 없음)
│       ├── bus.js                # 모듈 간 이벤트 버스 (추가 Firestore 읽기 없이 데이터 재사용)
│       ├── scrollui.js           # 읽기 진행 바 + 맨 위로 버튼
│       ├── reveal.js             # 스크롤 시 카드 등장 애니메이션
│       ├── puzzle.js             # 푸터 히든 이스터에그 진입점
│       └── utils.js              # 공용 포맷팅/이스케이프/검증 유틸
├── index.html                    # <!-- include --> 마커만 남은 단일 진입 HTML
├── firebase.json                 # Firestore 규칙 경로 및 로컬 에뮬레이터 설정
├── firebase.rules                # Firestore 보안 규칙 — 쓰기 권한·일일 한도·사칭 방지를 서버에서 강제
├── test/
│   └── rules.test.mjs            # 보안 규칙 회귀 테스트 (에뮬레이터에 실제 공격 시나리오를 던져 검증)
├── .gitignore
├── package.json                  # 빌드 스크립트 및 디펜던시 정의 메타 데이터 파일
├── vite.config.js                # <!-- include --> 치환 플러그인 및 빌드 설정
└── vercel.json                   # Vercel 배포 시 SPA 라우팅 재작성 및 보안 헤더(CSP 등) 설정
```

---

## 🚀 구동 및 빌드 방식 (How to Run)

로컬 개발 환경 구축과 릴리즈용 정적 리소스 생성, 그리고 배포 방식에 대한 구동 명령어는 다음과 같습니다.

### 1. 개발 전제 조건 (Prerequisites)
- 컴퓨터에 Node.js LTS 버전이 설치되어 있어야 합니다.

### 2. 패키지 설치
프로젝트 루트 폴더로 이동한 뒤, 터미널을 열고 모든 필요 의존 패키지(Vite, Firebase)를 안전하게 설치합니다.
```bash
npm install
```

### 3. 로컬 개발 서버 구동 (Local Dev Run)
Vite가 제공하는 초고속 핫 모듈 리로딩(HMR) 로컬 개발 서버를 가동합니다. 소스코드를 수정하면 브라우저에 즉시 실시간 반영됩니다.
```bash
npm run dev
```
- 서버 기동이 성공하면 터미널에 출력되는 `http://localhost:5173` 경로를 통해 브라우저에서 동아리 사이트를 실시간으로 제어할 수 있습니다.

### 4. 배포용 정적 리소스 컴파일 (Production Build)
웹 브라우저가 고속으로 다운로드 및 렌더링할 수 있도록 코드 축소(Minify), 정적 경로 보정, 트리 쉐이킹(Tree-shaking) 및 캐싱 최적화 가공이 포함된 배포용 결과물을 추출합니다.
```bash
npm run build
```
- 빌드가 성공적으로 완료되면 루트 디렉토리에 **`dist/`** 폴더가 생성됩니다. 이 폴더 안에 들어가는 `index.html`, `.nojekyll`, 그리고 에셋 파일들 전체가 Vercel(`vercel.json` 설정 포함) 호스팅 서버로 전달됩니다.

### 5. 보안 규칙 회귀 테스트 (Security Rules Test)
`firebase.rules`를 수정했다면 배포 전에 반드시 이 테스트를 돌리세요. 실제 공격 시나리오(작성자 사칭, 일일 한도 우회, 첨부 정책 우회 등)를 로컬 Firestore 에뮬레이터에 그대로 던져서 **막혀야 할 것이 막히는지**와 **정상 동작이 깨지지 않았는지**를 함께 검증합니다.

```bash
npm i --no-save firebase-tools @firebase/rules-unit-testing firebase   # 최초 1회 (Java 필요)
npm run test:rules
```
- 테스트 본체는 `test/rules.test.mjs`이며, 배포 번들과 무관하므로 위 패키지는 `--no-save`로만 설치합니다(운영 의존성에 포함시키지 않기 위함).
- 규칙은 조건을 함수 안쪽에 두느냐 top-level에 두느냐에 따라 평가 결과가 달라지는 사례가 실제로 있었습니다. "고쳤다고 생각했는데 안 고쳐진" 상황을 잡아내는 것이 이 테스트의 목적입니다.

---

## ⚖️ 기여 및 행동 규범 (Contribution & Code of Conduct)

- **상호 존중:** 본 플랫폼은 동아리의 건전한 소통과 자치를 추구합니다. 실시간 소통망 및 댓글에서 욕설, 조롱, 도배성 메시지가 검출될 경우 관리자에 의해 경고 수치가 누적 가산되며, 누적 시 계정이 즉각 정지됩니다.
- **법적 처벌 고지:** 비인가 도구를 사용해 타인의 가입 정보를 무단 도용하거나 데이터베이스를 조작 및 폐쇄시키려는 악의적 목적의 침입 시도가 감지될 경우, 동아리는 관련 IP 및 접속 증거 로그를 취합하여 즉시 **KISA(한국인터넷진흥원) 및 경찰청 사이버범죄수사대**에 고발 수사 의뢰할 것을 엄중히 경고합니다.

---

## 📚 관련 문서 (Related Documents)

- [개인정보 처리방침](./개인정보%20처리방침.md)
- [커뮤니티 이용 가이드라인](./커뮤니티%20이용%20가이드라인.md)
- [관리자 계정 가이드](./관리자%20계정%20가이드.md)

---

## 📄 라이선스 (License)

This project is licensed under the Apache License 2.0 - See the LICENSE file for details.
