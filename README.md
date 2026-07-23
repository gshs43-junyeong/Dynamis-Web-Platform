# ⚙️ Dynamis Web Platform - 경남과학고등학교 학술 동아리 웹 플랫폼

<div align="center">
  <br>

  <p align="center">
    <strong>"공학적인 원리를 깨닫고 이를 활용하여 깊은 생각과 탐구를 통해 답을 찾고자 하는 집단"</strong>
  </p>

 (https://img.shields.io/badge/Language-HTML5%20%2F%20CSS3%20%2F%20Vanilla%20JS-F05340?style=flat-square)](https://github.com)
 ![Vite](https://img.shields.io/badge/Bundler-Vite-646CFF?style=flat-square&logo=vite)
 ![Firebase](https://img.shields.io/badge/Database-Firebase%20Firestore-FFCA28?style=flat-square&logo=firebase)
 ![App Check](https://img.shields.io/badge/Security-App%20Check%20reCAPTCHA%20Enterprise-4285F4?style=flat-square&logo=google)
 ![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)
</div>

---

## 💡 동아리 정체성 및 비전 (Identity & Vision)

**디나미스(Dynamis)**는 경남과학고등학교 제42기 때 결성된 학술 소통의 중심지입니다. 우리는 단순한 이론의 주입식 습득을 거부하며, 수학과 기계공학의 유기적인 결합을 기반으로 실질적인 문제 해결 과정을 탐구하고 이를 웹 기술을 통해 안전한 플랫폼으로 실현합니다.

---

## 🛠️ 핵심 기능 (Core Features)

1. **정적 SPA 라우팅의 한계 우회:** 정적 호스팅 서비스(GitHub Pages)가 갖는 무상태 한계를 극복하고자 `404.html` 경로 우회 처리(Routing Hack) 및 브라우저 세션 상태 재수화(Rehydration) 기술을 이식하여 새로고침 시에도 화면이 파손되지 않습니다.
2. **트래픽 스로틀링 보안망:** 악성 매크로 및 디도스(DDoS)로부터 파이어베이스 서버의 과금을 방어하기 위해 부원별 일일 공지글 5회, 댓글 10회, 첨부파일 업로드 2MB, 다운로드 5MB 제한 기술을 실시간 트랜잭션으로 강제합니다.
3. **App Check & reCAPTCHA Enterprise 연동:** 외부 비인가 프로그램(Python Request, cURL 등)을 통한 Firestore 데이터베이스 위변조 및 탈취 행위를 Google 보안 서버 인증 토큰을 통해 원천 무력화합니다.
4. **연쇄적 개인정보 파기 영구 삭제:** 대한민국 개인정보보호법에 준거하여 사용자가 '탈퇴' 시 본인의 계정은 물론 그동안 데이터베이스에 작성했던 공지사항, 실시간 채팅 댓글, 일일 트래픽 기록을 원자성(Atomicity) 일괄 배치(Batch)로 단 1초 만에 흔적 없이 완전 삭제 처리합니다.

---

## 📂 디렉토리 구조 (Directory Structure)

```
dynamis-platform/
├── public/
│   ├── logo.png               # 동아리 공식 심벌 로고
│   ├── figure1.png            # 수학 및 기계공학 학술 도해
│   ├── figure2.png            # 기계공학 메커니즘 도해
│   ├── 404.html               # SPA 하위 경로 새로고침 우회 리다이렉트 게이트웨이
│   └── .nojekyll              # GitHub Pages의 Jekyll 정적 빌드 필터링 무력화 파일
├── src/
│   ├── css/
│   │   └── style.css          # 다크 테마 레이아웃 및 컴포넌트 전용 통합 스타일시트
│   └── js/
│       ├── app.js             # 싱글 페이지 앱(SPA) 라우터 및 네비게이션 제어 허브
│       ├── firebase-config.js # Firebase App Check 및 SDK v10+ 함수형 모듈 초기화
│       ├── auth.js            # ID 필터 검증, 로그인 유지 및 연쇄 회원 탈퇴 로직
│       └── traffic.js         # DDoS 방어 일일 트래픽 측정 및 실시간 가산 트랜잭션
├── index.html                 # 단일 메인 인덱스 파일 (라우팅 복원 스크립트 내장)
├── .gitignore                 # Admin의 다른 계정 접근 권한 우회
├── package.json               # 빌드 스크립트 및 디펜던시 정의 메타 데이터 파일
├── vite.config.js             # 깃허브 Pages 배포 경로 조정을 위한 Vite 설정 파일
└── vercel.json                # 모든 경로 요청을 index.html로 연결
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
- 빌드가 성공적으로 완료되면 루트 디렉토리에 **`dist/`** 폴더가 생성됩니다. 이 폴더 안에 들어가는 `index.html`, `404.html`, `.nojekyll`, 그리고 에셋 파일들 전체가 GitHub Pages 호스팅 서버로 전달됩니다.

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
```
