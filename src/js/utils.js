export const ITEMS_PER_PAGE = 15;

// UI 아이콘.
//
// 하트/작성자/작성시간 같은 표시는 원래 이모지(🤍 ✍️ 📅 …)를 그대로 글자로 찍었다.
// 이모지는 기기가 가진 글꼴로 그려지기 때문에 안드로이드·윈도우·애플이 서로 다른
// 그림을 보여주고, 굵기·색·크기가 제각각이라 화면 톤이 흐트러진다. 일부 환경에서는
// 아예 네모로 깨진다. 그래서 사이트가 직접 소유한 PNG로 바꿨다.
//   - 원본(SVG): tools/icons/src/*.svg
//   - 굽는 법:   python3 tools/icons/build_icons.py  →  public/icons/*.png
//
// 장식용이라 스크린리더에는 읽히지 않게 하고(aria-hidden), 의미는 항상 옆의 텍스트가
// 전달하도록 둔다. 크기는 CSS에서 em으로 잡아 주변 글자 크기를 따라간다.
const ICON_BASE = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/icons`;

export function uiIcon(name, { muted = false, className = '' } = {}) {
    const img = document.createElement('img');
    img.src = `${ICON_BASE}/${name}.png`;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.width = 16;
    img.height = 16;
    img.className = ['ui-icon', muted ? 'ui-icon-muted' : '', className].filter(Boolean).join(' ');
    return img;
}

// 아이콘 + 텍스트를 한 덩어리로 묶어 반환한다 (아이콘이 줄바꿈으로 텍스트와 떨어지지 않게).
export function iconLabel(name, text, { muted = false } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'icon-label';
    wrap.appendChild(uiIcon(name, { muted }));
    const span = document.createElement('span');
    span.textContent = text;
    wrap.appendChild(span);
    return wrap;
}

export function escapeHTML(str) {
    if (!str) return "";
    return str.toString().replace(/[&<>'"]/g, function (tag) {
        const charsToReplace = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
        return charsToReplace[tag] || tag;
    });
}

export function getRoleLabel(role) {
    if (role === 'admin') return '관리자';
    if (role === 'member') return '부원';
    if (role === 'honored') return '명예부원';
    return '등급 없음';
}

export function formatAuthorLabel(author) {
    const name = author?.authorName || '알수없음';
    const batch = author?.authorBatch || '';
    const role = getRoleLabel(author?.authorRole);
    if (batch && name) return `${batch} ${name} (${role})`;
    if (name) return `${name} (${role})`;
    return `사용자 (${role})`;
}

export function formatAuthorBatchName(author) {
    const name = author?.authorName || '알수없음';
    const batch = author?.authorBatch || '';
    return batch ? `${batch} ${name}` : name;
}

export function formatUserIdentityLabel(user) {
    if (!user) return '비로그인';
    const batch = user.batch ? `${user.batch}` : '';
    const rawName = user.name || user.displayName || user.email?.split('@')[0] || '';
    const displayName = rawName;
    if (batch && displayName) return `${batch} ${displayName}`;
    if (displayName) return displayName;
    return '사용자';
}

export function formatUserDisplayLabel(user) {
    if (!user) return '비로그인';
    const batch = user.batch ? `${user.batch}` : '';
    const rawName = user.name || user.displayName || user.email?.split('@')[0] || '';
    const displayName = rawName;
    const role = getRoleLabel(user.role);
    if (batch && displayName) return `${batch} ${displayName} (${role})`;
    if (displayName) return `${displayName} (${role})`;
    return role;
}

export function getByteLength(str) {
    return new TextEncoder().encode(str).length;
}

// 첨부파일 href 검증.
//
// files[].fileData는 SDK/REST로 문서를 직접 쓰면 공격자 통제 하에 놓일 수 있는
// 값이다(서버 규칙은 문자열 길이 상한을 검사하지만 내용 자체는 검사하지 않는다).
// 다운로드 처리에서 이 값을 <a>.href에 넣고 click()을 부르므로, 값이
// 'javascript:...'이면 download 속성이 붙어 있어도 그대로 실행된다(브라우저에서
// 실측 확인함 — download는 javascript: 스킴을 다운로드로 바꿔주지 않는다).
// 저장형 XSS가 되므로 스킴을 화이트리스트로 막는다.
//
// 정상 업로드 경로(FileReader.readAsDataURL)는 항상 'data:'로 시작하므로
// data: 이외의 스킴은 전부 조작된 값으로 간주하고 거부한다.
export function isSafeAttachmentData(dataStr) {
    return typeof dataStr === 'string' && /^data:[a-z0-9.+-]+\/[a-z0-9.+-]*[;,]/i.test(dataStr);
}

// 첨부파일 용량 상한. firebase.rules의 isAllowedAttachment()와 반드시 같은 값을
// 유지해야 한다 — 여기서 막으면 큰 파일을 FileReader로 읽어 브라우저 메모리에
// 올리기 전에 끝나고(관리자 계정도 예외 없음), 실수로 통과해도 서버가 최종
// 방어선으로 다시 막는다.
//
// MAX_ATTACHMENT_FILE_BYTES: 원본 파일 크기 상한(base64 인코딩 시 약 4/3로
// 늘어나므로, 서버의 파일당 700,000자 상한보다 넉넉히 낮게 잡아 인코딩 후에도
// 항상 서버 한도 안에 들어오게 한다).
// MAX_ATTACHMENT_TOTAL_ENCODED_BYTES: 인코딩 후 첨부 합계 상한(서버와 동일한 값).
export const MAX_ATTACHMENT_FILE_BYTES = 500 * 1024;
export const MAX_ATTACHMENT_TOTAL_ENCODED_BYTES = 900000;

export const NOTICE_TAGS = ['학술 자료', '이벤트 안내', '설문 조사', '활동 기록', '기타'];

// URL은 http(s):// 또는 www.로 시작하는 형태만 인식한다 (javascript: 등 다른 스킴은
// 애초에 매치되지 않으므로 XSS 벡터가 되지 않음). 문장 부호가 URL 끝에 붙어 쓰인 경우
// (마침표, 쉼표, 괄호 등)는 링크에서 제외하고 원래 텍스트로 남긴다.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
const TRAILING_PUNCT_REGEX = /[.,:;!?'")\]]+$/;

// 공지/이벤트 본문에서 URL을 자동으로 클릭 가능한 링크로 바꾼다.
// escapeHTML을 먼저 적용해 원본 텍스트에 있던 HTML 특수문자를 전부 무력화한 뒤,
// 그 이스케이프된 문자열 위에서만 URL을 찾아 <a> 태그로 감싸므로 안전하다.
export function linkifyText(str) {
    const escaped = escapeHTML(str);
    return escaped.replace(URL_REGEX, (match) => {
        const trailingMatch = match.match(TRAILING_PUNCT_REGEX);
        const trailing = trailingMatch ? trailingMatch[0] : '';
        const url = trailing ? match.slice(0, match.length - trailing.length) : match;
        if (!url) return match;
        const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow" class="content-link">${url}</a>${trailing}`;
    });
}
