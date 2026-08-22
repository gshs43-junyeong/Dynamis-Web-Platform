import { db, auth as firebaseAuth } from './firebase-config.js';
import { readTrafficState, withinLimit, stageQuota, checkAndRecordDownload } from './traffic.js';
import {
    collection,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    query,
    addDoc,
    updateDoc,
    deleteDoc,
    orderBy,
    writeBatch
} from "firebase/firestore";
import { ITEMS_PER_PAGE, formatAuthorLabel, getByteLength, NOTICE_TAGS, linkifyText, isSafeAttachmentData, hasAllowedAttachmentName, ALLOWED_ATTACHMENT_EXTENSION_LABEL, MAX_ATTACHMENT_FILE_BYTES, MAX_ATTACHMENT_TOTAL_ENCODED_BYTES, uiIcon, iconLabel } from './utils.js';
import { loggedInUser, ensureAdminAction } from './state.js';
import { renderLikeWidget } from './likes.js';
import { emit, EVENTS } from './bus.js';
import { isUnread, createNewBadge } from './unread.js';

let notices = [];
let displayNoticesGlobal = [];
let currentNoticeDocId = null;
let commentsSnapshotListener = null;
let noticeLikeUnsub = null;
let currentPage = 1;
let activeTagFilter = null;

// 태그 텍스트(한글)를 CSS 클래스에 쓸 수 있는 슬러그로 매핑.
const TAG_SLUG_MAP = {
    '학술 자료': 'academic',
    '이벤트 안내': 'event',
    '설문 조사': 'survey',
    '활동 기록': 'activity',
    '기타': 'etc'
};
function tagSlug(tag) {
    return TAG_SLUG_MAP[tag] || 'etc';
}

export async function addNotice() {
    const titleInput = document.getElementById('post-title');
    const contentInput = document.getElementById('post-content');
    const fileInput = document.getElementById('post-file');
    const tagSelect = document.getElementById('post-tag');

    const title = titleInput?.value.trim();
    const content = contentInput?.value.trim();
    const tag = tagSelect?.value || '';
    if (!title || !content) return alert('제목과 내용을 빠짐없이 기입해 주세요.');
    if (!NOTICE_TAGS.includes(tag)) return alert('공지 태그를 선택해 주세요.');
    if (!loggedInUser) return alert('인증 세션이 만료되었습니다.');

    const uid = firebaseAuth.currentUser?.uid;
    const isAdmin = loggedInUser.role === 'admin';

    // 관리자는 기존대로 한도에서 제외된다(규칙도 동일하게 예외 처리).
    let trafficState = null;
    if (!isAdmin) {
        const contentBytes = getByteLength(content);
        if (contentBytes > 2000) {
            alert(`❌ [바이트 초과] 공지사항 본문 크기가 2000바이트를 초과하여 게시할 수 없습니다. (현재: ${contentBytes}바이트)`);
            return;
        }

        trafficState = await readTrafficState(uid);
        if (!trafficState.ok) {
            alert('⚠️ 작성 가능 여부를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n(' + (trafficState.message || '') + ')');
            return;
        }
        if (!withinLimit(trafficState, 'noticeCount', 1, 5)) {
            alert('❌ [작성 빈도 제한] 악성 트래픽 및 오뷰즈 방어 정책에 의해 하루 최대 공지사항 작성 한도(5회)를 초과하여 차단되었습니다.');
            return;
        }
    }

    const uploadedFilesArray = [];
    let totalNewSize = 0;
    if (fileInput?.files.length > 0) {
        if (loggedInUser.role === 'honored') {
            alert('❌ 명예부원 등급은 파일 업로드가 절대 허용되지 않습니다.');
            return;
        }

        for (let i = 0; i < fileInput.files.length; i++) {
            totalNewSize += fileInput.files[i].size;
        }

        // 개별 파일이 너무 크면 FileReader로 전체를 메모리에 올리기 전에 즉시 막는다.
        // 관리자 계정도 예외가 없다 — 예전에는 아래 일일 한도 체크만 관리자에게
        // 생략됐을 뿐 이 검사 자체가 없어서, 큰 파일을 선택하면 서버에 닿기도 전에
        // 브라우저가 멈추거나 크래시할 수 있었다.
        const oversizedFile = Array.from(fileInput.files).find((f) => f.size > MAX_ATTACHMENT_FILE_BYTES);
        if (oversizedFile) {
            alert(`❌ [파일 크기 초과] "${oversizedFile.name}" 파일이 첨부 가능한 개별 용량(${Math.floor(MAX_ATTACHMENT_FILE_BYTES / 1024)}KB)을 초과합니다.`);
            return;
        }

        // 확장자 화이트리스트. 받는 사람이 파일을 열었을 때 무엇이 실행되는지는
        // 저장된 이름의 확장자가 정하므로(.html이면 브라우저가 로컬에서 실행한다),
        // 여기서 먼저 막는다. 같은 검사가 firebase.rules에도 있어 UI를 우회해도
        // 서버에서 다시 걸린다.
        const badNameFile = Array.from(fileInput.files).find((f) => !hasAllowedAttachmentName(f.name));
        if (badNameFile) {
            alert(`❌ [허용되지 않는 형식] "${badNameFile.name}"은(는) 첨부할 수 없습니다.\n허용 확장자: ${ALLOWED_ATTACHMENT_EXTENSION_LABEL}`);
            return;
        }

        if (!isAdmin) {
            const uploadLimit = 2 * 1024 * 1024;
            if (!withinLimit(trafficState, 'uploadBytes', totalNewSize, uploadLimit)) {
                alert('⚠️ [업로드 제한] 하루 최대 파일 업로드 총량(2MB)을 초과하였거나 이번 파일이 허용치를 초과했습니다.');
                return;
            }
        }

        for (let i = 0; i < fileInput.files.length; i++) {
            const file = fileInput.files[i];
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            uploadedFilesArray.push({ fileName: file.name, fileSize: file.size, fileData: data });
        }

        // 인코딩(base64) 후 합계가 서버 규칙의 상한을 넘지 않는지 마지막으로 확인.
        const totalEncodedBytes = uploadedFilesArray.reduce((sum, f) => sum + f.fileData.length, 0);
        if (totalEncodedBytes > MAX_ATTACHMENT_TOTAL_ENCODED_BYTES) {
            alert('❌ [첨부 합계 초과] 첨부파일들의 합계 용량이 허용치를 초과합니다. 파일 수를 줄이거나 더 작은 파일로 시도해 주세요.');
            return;
        }
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    // 목록 카드(항상 읽기 가능, 가볍다) — 본문·첨부는 별도 문서에 넣어 목록을
    // 보기만 하는 방문자가 그 바이트를 매번 내려받지 않게 한다. hasFiles는 목록의
    // 첨부 아이콘 표시용 불리언 하나만 남겨 둔 것이라 비용에 영향이 없다.
    const noticeCard = {
        title,
        tag,
        authorName: loggedInUser.name,
        authorBatch: loggedInUser.batch,
        authorRole: loggedInUser.role,
        authorId: uid,
        date,
        pinned: false,
        hasFiles: uploadedFilesArray.length > 0,
        timestamp: Date.now()
    };

    try {
        // 카드와 카운터는 한 배치로 원자적으로 쓴다(규칙이 getAfter로 대조).
        // 본문은 카드가 커밋된 뒤에 써야 한다 — 본문 규칙이 카드 문서를 get()으로
        // 읽어 작성자를 확인하므로 같은 배치에 넣으면 아직 없는 것으로 보인다.
        const noticeRef = doc(collection(db, 'notices'));
        const batch = writeBatch(db);
        batch.set(noticeRef, noticeCard);
        if (!isAdmin) {
            const deltas = { noticeCount: 1 };
            if (totalNewSize > 0) deltas.uploadBytes = totalNewSize;
            stageQuota(batch, uid, trafficState, deltas);
        }
        await batch.commit();

        await setDoc(doc(db, 'notices', noticeRef.id, 'content', 'main'), {
            content,
            files: uploadedFilesArray
        });
        if (titleInput) titleInput.value = '';
        if (contentInput) contentInput.value = '';
        if (fileInput) fileInput.value = '';
        if (tagSelect) tagSelect.value = '';
        alert('공지사항이 성공적으로 등록되었습니다.');
    } catch (err) {
        alert('작성 실패 (파일 용량이 너무 크거나 서버 통신 오류입니다): ' + err.message);
    }
}

export async function togglePin(docId, isChecked) {
    if (!ensureAdminAction()) return;
    await updateDoc(doc(db, 'notices', docId), { pinned: isChecked });
}

export function renderNotices() {
    const list = document.getElementById('notice-list');
    if (!list) return;

    const isAdmin = loggedInUser && loggedInUser.role === 'admin';
    const pinHeader = document.getElementById('th-pin-header');
    if (pinHeader) pinHeader.style.display = isAdmin ? 'table-cell' : 'none';

    const filteredNotices = activeTagFilter
        ? notices.filter((n) => n.tag === activeTagFilter)
        : notices;

    displayNoticesGlobal = [...filteredNotices].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
    updateTagFilterButtonsUI();
    renderNoticePage(currentPage);
}

// 공지 목록 상단 태그 필터 버튼 클릭 시 호출. 빈 문자열(또는 falsy 값)은 "전체"를 뜻한다.
export function changeNoticeTagFilter(tag) {
    activeTagFilter = tag || null;
    currentPage = 1;
    renderNotices();
}

function updateTagFilterButtonsUI() {
    document.querySelectorAll('.notice-tag-filter-btn').forEach((btn) => {
        const btnTag = btn.dataset.tag || '';
        btn.classList.toggle('active', btnTag === (activeTagFilter || ''));
    });
}

function renderNoticePage(pageNum) {
    const list = document.getElementById('notice-list');
    if (!list) return;
    list.innerHTML = '';
    const isAdmin = loggedInUser && loggedInUser.role === 'admin';

    const startIdx = (pageNum - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const slicedNotices = displayNoticesGlobal.slice(startIdx, endIdx);

    slicedNotices.forEach((n, index) => {
        const tr = document.createElement('tr');
        if (n.pinned) tr.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';

        if (isAdmin) {
            const pinTd = document.createElement('td');
            pinTd.className = 'pin-col';
            const pinInput = document.createElement('input');
            pinInput.type = 'checkbox';
            pinInput.className = 'pin-checkbox';
            pinInput.checked = !!n.pinned;
            pinInput.addEventListener('change', () => togglePin(n.docId, pinInput.checked));
            pinTd.appendChild(pinInput);
            tr.appendChild(pinTd);
        }

        const titleTd = document.createElement('td');
        titleTd.className = 'clickable-td';
        if (n.tag) {
            const tagBadge = document.createElement('span');
            tagBadge.className = `notice-tag-badge notice-tag-${tagSlug(n.tag)}`;
            tagBadge.textContent = n.tag;
            titleTd.appendChild(tagBadge);
        }
        if (n.pinned) titleTd.appendChild(uiIcon('pin', { className: 'icon-lead' }));
        const titleTextSpan = document.createElement('span');
        titleTextSpan.textContent = `${n.pinned ? '[고정] ' : ''}${n.title || ''}`;
        titleTd.appendChild(titleTextSpan);
        // hasFiles는 새 형태(카드+본문 분리) 공지의 첨부 표시용, n.files는 아직
        // 이관되지 않은 옛 형태(카드에 본문·첨부가 그대로 있는) 공지를 위한 대비다.
        if (n.hasFiles || (n.files && n.files.length)) {
            titleTd.appendChild(uiIcon('paperclip', { muted: true, className: 'icon-trail' }));
        }
        if (isUnread('notice', n.timestamp)) titleTd.appendChild(createNewBadge());
        titleTd.addEventListener('click', () => viewNotice(startIdx + index));
        tr.appendChild(titleTd);

        const authorTd = document.createElement('td');
        authorTd.style.color = 'var(--text-secondary)';
        authorTd.style.fontSize = '0.95rem';
        authorTd.textContent = formatAuthorLabel(n);
        tr.appendChild(authorTd);

        const dateTd = document.createElement('td');
        dateTd.style.color = 'var(--text-secondary)';
        dateTd.style.fontSize = '0.95rem';
        dateTd.textContent = n.date || '';
        tr.appendChild(dateTd);

        list.appendChild(tr);
    });
    renderPaginationControls();
}

function renderPaginationControls() {
    const container = document.getElementById('pagination-controls');
    if (!container) return;
    container.innerHTML = '';

    const totalPages = Math.ceil(displayNoticesGlobal.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const PAGE_BLOCK_SIZE = 10;
    const currentBlock = Math.ceil(currentPage / PAGE_BLOCK_SIZE);
    const startPage = (currentBlock - 1) * PAGE_BLOCK_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_BLOCK_SIZE - 1, totalPages);

    if (startPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.innerText = '이전';
        prevBtn.type = 'button';
        prevBtn.className = 'page-btn';
        prevBtn.onclick = () => changePage(startPage - 1);
        container.appendChild(prevBtn);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.innerText = `${i}`;
        btn.type = 'button';
        btn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
        btn.onclick = () => changePage(i);
        container.appendChild(btn);
    }

    if (endPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.innerText = '다음';
        nextBtn.type = 'button';
        nextBtn.className = 'page-btn';
        nextBtn.onclick = () => changePage(endPage + 1);
        container.appendChild(nextBtn);
    }
}

export function changePage(pageNum) {
    currentPage = pageNum;
    renderNoticePage(currentPage);
}

export function viewNotice(index) {
    openNoticeDetail(displayNoticesGlobal[index]);
}

// docId로 바로 상세를 연다. 홈 대시보드·통합 검색처럼 목록 인덱스를 모르는
// 곳에서 쓰기 위한 진입점 (태그 필터에 걸려 목록에 없는 글도 열 수 있다).
export function openNoticeById(docId) {
    openNoticeDetail(notices.find((n) => n.docId === docId));
}

async function openNoticeDetail(n) {
    if (!n) return;
    currentNoticeDocId = n.docId;

    const modalTitle = document.getElementById('modal-title');
    const modalTag = document.getElementById('modal-tag');
    const modalAuthor = document.getElementById('modal-author');
    const modalDate = document.getElementById('modal-date');
    const modalText = document.getElementById('modal-text');
    const modalDeleteBtn = document.getElementById('modal-delete-btn');
    const fileBox = document.getElementById('modal-file-box');
    const fileListContainer = document.getElementById('modal-file-list');

    if (modalTitle) modalTitle.innerText = n.title;
    if (modalTag) {
        if (n.tag) {
            modalTag.textContent = n.tag;
            modalTag.className = `notice-tag-badge notice-tag-${tagSlug(n.tag)}`;
            modalTag.style.display = 'inline-block';
        } else {
            modalTag.style.display = 'none';
        }
    }
    if (modalAuthor) {
        modalAuthor.innerHTML = '';
        modalAuthor.appendChild(iconLabel('author', formatAuthorLabel(n)));
    }
    if (modalDate) {
        modalDate.innerHTML = '';
        modalDate.appendChild(iconLabel('calendar', n.date || '', { muted: true }));
    }
    if (modalDeleteBtn) modalDeleteBtn.style.display = (loggedInUser && loggedInUser.role === 'admin') ? 'block' : 'none';

    if (noticeLikeUnsub) { noticeLikeUnsub(); noticeLikeUnsub = null; }
    noticeLikeUnsub = renderLikeWidget(document.getElementById('notice-like-mount'), ['notices', n.docId]);

    if (fileListContainer) fileListContainer.innerHTML = '';
    if (fileBox) fileBox.style.display = 'none';

    // 옛 형태(카드에 본문·첨부가 그대로 있는) 공지는 바로 보여주고, 새 형태는
    // notices/{id}/content/main에서 따로 읽어온다 — 목록을 볼 때는 이 바이트를
    // 아예 내려받지 않다가, 글을 열 때만 딱 그 글의 본문만 받는다.
    let content = n.content;
    let files = n.files || [];
    if (content === undefined) {
        if (modalText) modalText.innerText = '';
        try {
            const contentSnap = await getDoc(doc(db, 'notices', n.docId, 'content', 'main'));
            const data = contentSnap.exists() ? contentSnap.data() : {};
            content = data.content || '';
            files = data.files || [];
        } catch (err) {
            if (modalText) modalText.innerText = '⛔ 본문을 불러오지 못했습니다.';
            content = null;
        }
    }
    if (content !== null && modalText) modalText.innerHTML = linkifyText(content || '');

    if (files.length > 0) {
        if (fileBox) fileBox.style.display = 'block';
        files.forEach((fObj) => {
            const link = document.createElement('a');
            link.className = 'file-item-link';
            link.href = '#';
            link.appendChild(uiIcon('file'));
            const fileLabel = document.createElement('span');
            fileLabel.textContent = `${fObj.fileName} 다운로드`;
            link.appendChild(fileLabel);
            link.onclick = (e) => {
                e.preventDefault();
                executeFileDownloadSecure(e, fObj.fileSize, fObj.fileData, fObj.fileName);
            };
            fileListContainer.appendChild(link);
        });
    }

    const commentWriteContainer = document.getElementById('comment-write-container');
    const commentGuestMessage = document.getElementById('comment-guest-message');
    if (commentWriteContainer) commentWriteContainer.style.display = loggedInUser ? 'block' : 'none';
    if (commentGuestMessage) commentGuestMessage.style.display = loggedInUser ? 'none' : 'block';

    if (commentsSnapshotListener) commentsSnapshotListener();
    commentsSnapshotListener = onSnapshot(
        query(collection(doc(db, 'notices', n.docId), 'comments'), orderBy('timestamp', 'asc')),
        (snapshot) => {
            const cList = document.getElementById('comment-list');
            if (!cList) return;
            cList.innerHTML = '';
            if (snapshot.empty) {
                cList.innerHTML = '';
                const emptyState = document.createElement('div');
                emptyState.style.color = 'var(--text-secondary)';
                emptyState.style.textAlign = 'center';
                emptyState.style.fontStyle = 'italic';
                emptyState.style.fontSize = '0.85rem';
                emptyState.style.padding = '1rem 0';
                emptyState.textContent = '등록된 댓글이 없습니다.';
                cList.appendChild(emptyState);
                return;
            }
            snapshot.forEach((docSnap) => {
                const c = docSnap.data();
                const item = document.createElement('div');
                item.className = 'comment-item';

                const header = document.createElement('div');
                header.className = 'comment-header';

                const authorSpan = document.createElement('span');
                authorSpan.style.color = '#fff';
                authorSpan.style.fontWeight = '700';
                authorSpan.textContent = formatAuthorLabel(c);

                const dateSpan = document.createElement('span');
                dateSpan.textContent = c.date || '';

                header.appendChild(authorSpan);
                header.appendChild(dateSpan);

                const body = document.createElement('div');
                body.className = 'comment-body';
                body.textContent = c.content || '';

                item.appendChild(header);
                item.appendChild(body);
                cList.appendChild(item);
            });
        }
    );

    const noticeModal = document.getElementById('notice-modal');
    if (noticeModal) noticeModal.style.display = 'flex';
}

async function executeFileDownloadSecure(e, size, dataStr, nameStr) {
    if (!loggedInUser) return alert('다운로드는 로그인된 회원 정보 세션이 있어야 동작합니다.');
    // 형식(MIME)과 저장될 이름(확장자)을 둘 다 본다. 규칙이 강화되기 전에 올라온
    // 문서나 SDK로 직접 쓴 문서가 남아 있을 수 있고, 실제로 사용자 기기에서 파일이
    // 열리는 지점이 바로 여기이기 때문이다.
    if (!isSafeAttachmentData(dataStr) || !hasAllowedAttachmentName(nameStr)) {
        alert('⛔ 첨부파일 형식이 올바르지 않아 다운로드를 차단했습니다. 관리자에게 신고해 주세요.');
        return;
    }
    if (loggedInUser.role !== 'admin') {
        const isDownloadAllowed = await checkAndRecordDownload(firebaseAuth.currentUser?.uid, size || 0, 5 * 1024 * 1024);
        if (!isDownloadAllowed) {
            alert('❌ [다운로드 제한] 하루 최대 파일 다운로드 총량(5MB) 한도를 초과하여 다운로드가 차단되었습니다.');
            return;
        }
    }
    const gateLink = document.createElement('a');
    gateLink.href = dataStr;
    gateLink.download = nameStr;
    document.body.appendChild(gateLink);
    gateLink.click();
    document.body.removeChild(gateLink);
}

export async function addComment() {
    if (!loggedInUser) return alert('로그인이 풀렸습니다.');
    const input = document.getElementById('comment-input');
    const commentVal = input?.value.trim();
    if (!commentVal) return;

    const uid = firebaseAuth.currentUser?.uid;
    const isAdmin = loggedInUser.role === 'admin';
    let trafficState = null;
    if (!isAdmin) {
        const bytes = getByteLength(commentVal);
        if (bytes > 500) {
            alert(`❌ [바이트 초과] 댓글 크기가 500바이트를 초과하여 등록할 수 없습니다. (현재: ${bytes}바이트)`);
            return;
        }
        trafficState = await readTrafficState(uid);
        if (!trafficState.ok) {
            alert('⚠️ 작성 가능 여부를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n(' + (trafficState.message || '') + ')');
            return;
        }
        if (!withinLimit(trafficState, 'commentCount', 1, 10)) {
            alert('❌ [작성 빈도 제한] 악성 트래픽 방어 정책에 의해 하루 최대 댓글 작성 가능 횟수(10회)를 초과하여 차단되었습니다.');
            return;
        }
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    try {
        const batch = writeBatch(db);
        batch.set(doc(collection(doc(db, 'notices', currentNoticeDocId), 'comments')), {
            content: commentVal,
            authorName: loggedInUser.name,
            authorBatch: loggedInUser.batch,
            authorRole: loggedInUser.role,
            authorId: uid,
            date,
            timestamp: Date.now()
        });
        if (!isAdmin) stageQuota(batch, uid, trafficState, { commentCount: 1 });
        await batch.commit();
        if (input) input.value = '';
        alert('댓글이 성공적으로 등록되었습니다.');
    } catch (err) {
        alert('댓글 등록에 실패했습니다: ' + err.message);
    }
}

export async function deleteCurrentNotice() {
    if (!ensureAdminAction()) return;
    if (!confirm('정말 이 공지사항을 삭제 처리 하시겠습니까? 복구가 불가합니다.')) return;
    if (!currentNoticeDocId) return;
    try {
        // 본문 문서 먼저 삭제한 뒤 카드 문서 삭제. 옛 형태 공지는 content/main이
        // 애초에 없으므로 실패를 조용히 넘긴다.
        await deleteDoc(doc(db, 'notices', currentNoticeDocId, 'content', 'main')).catch(() => {});
        await deleteDoc(doc(db, 'notices', currentNoticeDocId));
        alert('성공적으로 공지가 영구 제거되었습니다.');
        closeNotice();
    } catch (err) {
        alert('공지사항 삭제에 실패했습니다: ' + err.message);
    }
}

export function closeNotice() {
    const noticeModal = document.getElementById('notice-modal');
    if (noticeModal) noticeModal.style.display = 'none';
    if (commentsSnapshotListener) commentsSnapshotListener();
    if (noticeLikeUnsub) { noticeLikeUnsub(); noticeLikeUnsub = null; }
}

// 현재 메모리에 올라와 있는 공지 목록(읽기 전용 사본).
// 홈 대시보드·통합 검색이 Firestore를 다시 구독하지 않고 이 값을 재사용한다.
export function getNotices() {
    return notices.slice();
}

export function listenNotices() {
    onSnapshot(collection(db, 'notices'), (querySnapshot) => {
        notices = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            data.docId = docSnap.id;
            notices.push(data);
        });
        renderNotices();
        emit(EVENTS.NOTICES_CHANGED, notices);
    });
}
