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

// 개발 중에만 출력되는 로그.
//
// 개발하며 남긴 진행 로그가 배포본 콘솔에 그대로 찍히면, 공유 PC나 화면 공유
// 상황에서 로그인 상태 같은 정보가 옆 사람에게 그대로 보인다. Vite가 빌드 시
// import.meta.env.PROD를 true로 치환하므로 배포본에서는 아무것도 출력되지 않는다.
//
// 실제 장애 진단에 필요한 console.warn/error는 그대로 둔다 — 사용자에게는 alert로
// 일반화된 메시지가 나가고 상세는 콘솔에만 남는 구조를 유지하기 위함이다.
export function debugLog(...args) {
    if (!import.meta.env.PROD) console.log(...args);
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
//
// 스킴만 보는 것으로는 부족하다. data: 자체는 안전해도 MIME이 무제한이면
// 'data:text/html;base64,...'를 첨부로 심을 수 있고, 받는 사람이 그 파일을 열면
// 브라우저가 로컬 파일 컨텍스트에서 실행한다. 그래서 아래 화이트리스트로 좁힌다.
// image/svg+xml이 빠져 있는 것은 실수가 아니다 — SVG는 그림처럼 보이지만 스크립트를
// 품을 수 있는 문서 형식이라 같은 문제를 그대로 갖는다.
//
// hwp/hwpx는 브라우저가 MIME을 잘 몰라 application/octet-stream으로 넘기는 일이
// 많아서 octet-stream도 허용한다. 대신 이 구멍은 확장자 검사(아래
// hasAllowedAttachmentName)가 막는다 — 실제로 로컬에서 무엇으로 열릴지를 정하는
// 것은 MIME이 아니라 저장되는 파일 이름의 확장자이기 때문이다.
const ALLOWED_ATTACHMENT_MIME = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif',
    'image/heic', 'image/heif',
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown',
    'application/rtf', 'text/rtf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/haansofthwp', 'application/x-hwp', 'application/vnd.hancom.hwp', 'application/vnd.hancom.hwpx',
    'application/zip', 'application/x-zip-compressed',
    'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4',
    'application/octet-stream'
];

// 저장될 파일 이름에서 허용하는 확장자. MIME과 달리 이쪽이 "열었을 때 무엇이
// 실행되는가"를 실제로 결정한다 — 브라우저는 저장할 때 download 속성의 이름을
// 그대로 쓰므로, MIME이 무엇이든 .html로 저장되면 .html로 열린다.
//
// 화이트리스트로 두는 이유는, 위험한 확장자를 하나씩 지워 나가는 방식(.html,
// .exe, .hta, .scr, ...)은 플랫폼마다 목록이 달라 반드시 빠뜨리는 것이 생기기
// 때문이다. 여기 없는 형식(소스 코드 등)을 주고받아야 하면 zip으로 묶으면 된다.
// 목록을 늘릴 때는 "그 파일을 더블클릭했을 때 코드가 실행될 수 있는가"만 보면 된다.
// firebase.rules의 fileEntryOk()에 같은 목록이 정규식으로 들어가 있으니 함께 고칠 것.
const ALLOWED_ATTACHMENT_EXTENSIONS = [
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif',
    'pdf', 'txt', 'csv', 'md', 'rtf',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'hwp', 'hwpx',
    'zip',
    'mp4', 'mov', 'm4v', 'mp3', 'wav'
];

export function isSafeAttachmentData(dataStr) {
    if (typeof dataStr !== 'string') return false;
    const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)[;,]/i.exec(dataStr);
    if (!match) return false;
    return ALLOWED_ATTACHMENT_MIME.includes(match[1].toLowerCase());
}

/** 저장될 파일 이름이 허용 확장자로 끝나는지. 경로 구분자·제어문자도 함께 막는다. */
export function hasAllowedAttachmentName(fileName) {
    if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 200) return false;
    // 경로 탈출과 표시 조작(RTL override 등)에 쓰이는 문자를 먼저 걸러 낸다.
    // 서버 규칙(isAllowedAttachment)에도 같은 검사가 있다.
    if (/[/\\\u0000-\u001f\u202a-\u202e\u2066-\u2069]/.test(fileName)) return false;
    const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
    return fileName.includes('.') && ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext);
}

/** 사용자에게 보여 줄 허용 확장자 목록 (안내 문구용). */
export const ALLOWED_ATTACHMENT_EXTENSION_LABEL = ALLOWED_ATTACHMENT_EXTENSIONS.map((e) => '.' + e).join(', ');

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
