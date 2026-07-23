import { db, auth as firebaseAuth } from './firebase-config.js';
import { verifyAndIncrementTraffic, checkTrafficAllowed, commitTrafficIncrement } from './traffic.js';
import {
    collection,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    query,
    addDoc,
    deleteDoc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ITEMS_PER_PAGE, formatAuthorLabel, getByteLength, linkifyText } from './utils.js';
import { loggedInUser, ensureAdminAction } from './state.js';
import { renderLikeWidget } from './likes.js';
import { serverNow, isClockOutOfSync } from './clock.js';

let events = [];
let displayEventsGlobal = [];
let currentEventDocId = null;
let eventCommentsListener = null;
let eventLikeUnsub = null;
let currentEventPage = 1;

// 목록에 렌더된 타이머 셀들을 매초 갱신하기 위한 목록.
let timerCells = [];
let timerInterval = null;

function formatRemaining(ms) {
    if (ms <= 0) return '마감됨';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}일 ${h}시간`;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

function updateTimerCells() {
    const now = serverNow();
    timerCells.forEach(({ el, deadline }) => {
        const remaining = deadline - now;
        el.textContent = formatRemaining(remaining);
        el.classList.toggle('event-timer-expired', remaining <= 0);
    });
}

// 이벤트 열람 가능 여부(클라이언트 예비 판정). 최종 판정은 서버 규칙이 한다.
function canViewExpired(ev) {
    if (!loggedInUser) return false;
    if (loggedInUser.role === 'admin') return true;
    return firebaseAuth.currentUser?.uid === ev.authorId;
}

export async function addEvent() {
    const titleInput = document.getElementById('event-post-title');
    const contentInput = document.getElementById('event-post-content');
    const deadlineInput = document.getElementById('event-deadline-input');
    const fileInput = document.getElementById('event-post-file');

    const title = titleInput?.value.trim();
    const content = contentInput?.value.trim();
    const deadlineRaw = deadlineInput?.value;
    if (!title || !content) return alert('제목과 내용을 빠짐없이 기입해 주세요.');
    if (!deadlineRaw) return alert('마감 기한(날짜와 시간)을 지정해 주세요.');
    if (!loggedInUser) return alert('인증 세션이 만료되었습니다.');

    if (isClockOutOfSync()) {
        alert('⚠️ 기기 시계가 실제 시각과 20분 이상 차이납니다. 마감 타이머의 정확성을 위해 기기 시간을 자동 설정으로 맞춘 뒤 다시 시도해 주세요.');
        return;
    }

    const deadline = new Date(deadlineRaw).getTime();
    if (!Number.isFinite(deadline)) return alert('마감 기한 형식이 올바르지 않습니다.');
    if (deadline <= serverNow()) return alert('마감 기한은 현재 시각 이후여야 합니다.');

    const needsEventTrafficCheck = loggedInUser.role !== 'admin';
    if (needsEventTrafficCheck) {
        const contentBytes = getByteLength(content);
        if (contentBytes > 2000) {
            alert(`❌ [바이트 초과] 이벤트 본문 크기가 2000바이트를 초과하여 게시할 수 없습니다. (현재: ${contentBytes}바이트)`);
            return;
        }

        const eventTrafficResult = await checkTrafficAllowed(firebaseAuth.currentUser?.uid, 'eventCount', 1, 5);
        if (!eventTrafficResult.allowed) {
            if (eventTrafficResult.error) {
                alert('⚠️ 작성 가능 여부를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n(' + (eventTrafficResult.message || '') + ')');
            } else {
                alert('❌ [작성 빈도 제한] 하루 최대 이벤트 작성 한도(5회)를 초과하여 차단되었습니다.');
            }
            return;
        }
    }

    const uploadedFilesArray = [];
    let totalNewSize = 0;
    const needsUploadTrafficCheck = fileInput?.files.length > 0 && loggedInUser.role !== 'admin';
    if (fileInput?.files.length > 0) {
        if (loggedInUser.role === 'honored') {
            alert('❌ 명예부원 등급은 파일 업로드가 절대 허용되지 않습니다.');
            return;
        }

        for (let i = 0; i < fileInput.files.length; i++) {
            totalNewSize += fileInput.files[i].size;
        }

        if (needsUploadTrafficCheck) {
            const uploadLimit = 2 * 1024 * 1024;
            const uploadTrafficResult = await checkTrafficAllowed(firebaseAuth.currentUser?.uid, 'uploadBytes', totalNewSize, uploadLimit);
            if (!uploadTrafficResult.allowed) {
                if (uploadTrafficResult.error) {
                    alert('⚠️ 업로드 가능 여부를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n(' + (uploadTrafficResult.message || '') + ')');
                } else {
                    alert('⚠️ [업로드 제한] 하루 최대 파일 업로드 총량(2MB)을 초과하였거나 이번 파일이 허용치를 초과했습니다.');
                }
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
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    // 목록 카드(항상 읽기 가능) — 본문은 별도 문서에 넣어 마감 후 서버가 막는다.
    const eventCard = {
        title,
        authorName: loggedInUser.name,
        authorBatch: loggedInUser.batch,
        authorRole: loggedInUser.role,
        authorId: firebaseAuth.currentUser?.uid,
        date,
        deadline,
        timestamp: Date.now()
    };

    try {
        const eventRef = await addDoc(collection(db, 'events'), eventCard);
        await setDoc(doc(db, 'events', eventRef.id, 'content', 'main'), {
            content,
            files: uploadedFilesArray
        });
        if (needsEventTrafficCheck) {
            await commitTrafficIncrement(firebaseAuth.currentUser?.uid, 'eventCount', 1);
        }
        if (needsUploadTrafficCheck) {
            await commitTrafficIncrement(firebaseAuth.currentUser?.uid, 'uploadBytes', totalNewSize);
        }
        if (titleInput) titleInput.value = '';
        if (contentInput) contentInput.value = '';
        if (deadlineInput) deadlineInput.value = '';
        if (fileInput) fileInput.value = '';
        currentEventPage = 1;
        alert('이벤트가 성공적으로 등록되었습니다.');
    } catch (err) {
        alert('작성 실패 (파일 용량이 너무 크거나 서버 통신 오류입니다): ' + err.message);
    }
}

export function renderEvents() {
    const list = document.getElementById('event-list');
    if (!list) return;
    displayEventsGlobal = [...events].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    renderEventPage(currentEventPage);
}

function renderEventPage(pageNum) {
    const list = document.getElementById('event-list');
    if (!list) return;
    list.innerHTML = '';
    timerCells = [];

    const startIdx = (pageNum - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const slicedEvents = displayEventsGlobal.slice(startIdx, endIdx);

    slicedEvents.forEach((ev, index) => {
        const tr = document.createElement('tr');

        const titleTd = document.createElement('td');
        titleTd.className = 'clickable-td';
        titleTd.textContent = `${ev.title || ''}`;
        titleTd.addEventListener('click', () => viewEvent(startIdx + index));
        tr.appendChild(titleTd);

        const authorTd = document.createElement('td');
        authorTd.style.color = 'var(--text-secondary)';
        authorTd.style.fontSize = '0.95rem';
        authorTd.textContent = formatAuthorLabel(ev);
        tr.appendChild(authorTd);

        const timerTd = document.createElement('td');
        timerTd.className = 'event-timer-cell';
        timerTd.style.fontSize = '0.95rem';
        const remaining = (ev.deadline || 0) - serverNow();
        timerTd.textContent = formatRemaining(remaining);
        timerTd.classList.toggle('event-timer-expired', remaining <= 0);
        tr.appendChild(timerTd);
        timerCells.push({ el: timerTd, deadline: ev.deadline || 0 });

        const dateTd = document.createElement('td');
        dateTd.style.color = 'var(--text-secondary)';
        dateTd.style.fontSize = '0.95rem';
        dateTd.textContent = ev.date || '';
        tr.appendChild(dateTd);

        list.appendChild(tr);
    });
    renderEventPaginationControls();
}

function renderEventPaginationControls() {
    const container = document.getElementById('event-pagination-controls');
    if (!container) return;
    container.innerHTML = '';

    const totalPages = Math.ceil(displayEventsGlobal.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const PAGE_BLOCK_SIZE = 10;
    const currentBlock = Math.ceil(currentEventPage / PAGE_BLOCK_SIZE);
    const startPage = (currentBlock - 1) * PAGE_BLOCK_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_BLOCK_SIZE - 1, totalPages);

    if (startPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.innerText = '이전';
        prevBtn.type = 'button';
        prevBtn.className = 'page-btn';
        prevBtn.onclick = () => changeEventPage(startPage - 1);
        container.appendChild(prevBtn);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.innerText = `${i}`;
        btn.type = 'button';
        btn.className = `page-btn ${i === currentEventPage ? 'active' : ''}`;
        btn.onclick = () => changeEventPage(i);
        container.appendChild(btn);
    }

    if (endPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.innerText = '다음';
        nextBtn.type = 'button';
        nextBtn.className = 'page-btn';
        nextBtn.onclick = () => changeEventPage(endPage + 1);
        container.appendChild(nextBtn);
    }
}

export function changeEventPage(pageNum) {
    currentEventPage = pageNum;
    renderEventPage(currentEventPage);
}

async function viewEvent(index) {
    const ev = displayEventsGlobal[index];
    if (!ev) return;

    const expired = (ev.deadline || 0) - serverNow() <= 0;
    if (expired && !canViewExpired(ev)) {
        alert('⛔ 마감된 이벤트입니다. 내용을 확인할 수 없습니다.');
        return;
    }

    currentEventDocId = ev.docId;

    const modalTitle = document.getElementById('event-modal-title');
    const modalAuthor = document.getElementById('event-modal-author');
    const modalDate = document.getElementById('event-modal-date');
    const modalDeadline = document.getElementById('event-modal-deadline');
    const modalText = document.getElementById('event-modal-text');
    const modalDeleteBtn = document.getElementById('event-modal-delete-btn');
    const fileBox = document.getElementById('event-modal-file-box');
    const fileListContainer = document.getElementById('event-modal-file-list');

    if (modalTitle) modalTitle.innerText = ev.title || '';
    if (modalAuthor) modalAuthor.innerText = `✍️ ${formatAuthorLabel(ev)}`;
    if (modalDate) modalDate.innerText = `📅 ${ev.date || ''}`;
    if (modalDeadline) {
        const deadlineDate = new Date(ev.deadline || 0);
        const deadlineStr = deadlineDate.toLocaleString('ko-KR');
        modalDeadline.innerText = expired ? `⏰ 마감됨 (${deadlineStr})` : `⏰ 마감 ${deadlineStr}`;
        modalDeadline.classList.toggle('event-timer-expired', expired);
    }

    const isManager = loggedInUser && (loggedInUser.role === 'admin' || firebaseAuth.currentUser?.uid === ev.authorId);
    if (modalDeleteBtn) modalDeleteBtn.style.display = isManager ? 'block' : 'none';

    if (fileListContainer) fileListContainer.innerHTML = '';
    if (fileBox) fileBox.style.display = 'none';
    if (modalText) modalText.innerText = '';

    // 본문 문서를 서버에서 가져온다. 마감 후 비관리자/비작성자는 규칙이 막아 실패한다.
    let contentBlocked = false;
    try {
        const contentSnap = await getDoc(doc(db, 'events', ev.docId, 'content', 'main'));
        if (contentSnap.exists()) {
            const data = contentSnap.data();
            if (modalText) modalText.innerHTML = linkifyText(data.content || '');
            const filesToRender = data.files || [];
            if (filesToRender.length > 0 && fileListContainer) {
                if (fileBox) fileBox.style.display = 'block';
                filesToRender.forEach((fObj) => {
                    const link = document.createElement('a');
                    link.className = 'file-item-link';
                    link.href = '#';
                    link.innerText = `📄 ${fObj.fileName} 다운로드`;
                    link.onclick = (e) => {
                        e.preventDefault();
                        executeFileDownloadSecure(fObj.fileSize, fObj.fileData, fObj.fileName);
                    };
                    fileListContainer.appendChild(link);
                });
            }
        } else {
            contentBlocked = true;
        }
    } catch (err) {
        contentBlocked = true;
    }

    if (contentBlocked && modalText) {
        modalText.innerText = '⛔ 마감되어 내용을 확인할 수 없습니다.';
    }

    // 좋아요 위젯
    if (eventLikeUnsub) { eventLikeUnsub(); eventLikeUnsub = null; }
    eventLikeUnsub = renderLikeWidget(document.getElementById('event-like-mount'), ['events', ev.docId]);

    // 댓글
    const commentWriteContainer = document.getElementById('event-comment-write-container');
    const commentGuestMessage = document.getElementById('event-comment-guest-message');
    const commentsAllowed = !!loggedInUser && !contentBlocked;
    if (commentWriteContainer) commentWriteContainer.style.display = commentsAllowed ? 'block' : 'none';
    if (commentGuestMessage) commentGuestMessage.style.display = commentsAllowed ? 'none' : 'block';

    if (eventCommentsListener) eventCommentsListener();
    eventCommentsListener = onSnapshot(
        query(collection(doc(db, 'events', ev.docId), 'comments'), orderBy('timestamp', 'asc')),
        (snapshot) => {
            const cList = document.getElementById('event-comment-list');
            if (!cList) return;
            cList.innerHTML = '';
            if (snapshot.empty) {
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

    const eventModal = document.getElementById('event-modal');
    if (eventModal) eventModal.style.display = 'flex';
}

async function executeFileDownloadSecure(size, dataStr, nameStr) {
    if (!loggedInUser) return alert('다운로드는 로그인된 회원 정보 세션이 있어야 동작합니다.');
    if (loggedInUser.role !== 'admin') {
        const isDownloadAllowed = await verifyAndIncrementTraffic(firebaseAuth.currentUser?.uid, 'downloadBytes', size || 0, 5 * 1024 * 1024);
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

export async function addEventComment() {
    if (!loggedInUser) return alert('로그인이 풀렸습니다.');
    const input = document.getElementById('event-comment-input');
    const commentVal = input?.value.trim();
    if (!commentVal) return;

    if (loggedInUser.role !== 'admin') {
        const bytes = getByteLength(commentVal);
        if (bytes > 500) {
            alert(`❌ [바이트 초과] 댓글 크기가 500바이트를 초과하여 등록할 수 없습니다. (현재: ${bytes}바이트)`);
            return;
        }
        const commentTrafficResult = await checkTrafficAllowed(firebaseAuth.currentUser?.uid, 'commentCount', 1, 10);
        if (!commentTrafficResult.allowed) {
            if (commentTrafficResult.error) {
                alert('⚠️ 작성 가능 여부를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n(' + (commentTrafficResult.message || '') + ')');
            } else {
                alert('❌ [작성 빈도 제한] 하루 최대 댓글 작성 가능 횟수(10회)를 초과하여 차단되었습니다.');
            }
            return;
        }
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    try {
        await addDoc(collection(doc(db, 'events', currentEventDocId), 'comments'), {
            content: commentVal,
            authorName: loggedInUser.name,
            authorBatch: loggedInUser.batch,
            authorRole: loggedInUser.role,
            authorId: firebaseAuth.currentUser?.uid,
            date,
            timestamp: Date.now()
        });
        if (loggedInUser.role !== 'admin') {
            await commitTrafficIncrement(firebaseAuth.currentUser?.uid, 'commentCount', 1);
        }
        if (input) input.value = '';
        alert('댓글이 성공적으로 등록되었습니다.');
    } catch (err) {
        alert('댓글 등록에 실패했습니다: ' + err.message);
    }
}

export async function deleteCurrentEvent() {
    if (!loggedInUser) return;
    if (!confirm('정말 이 이벤트를 삭제 처리 하시겠습니까? 복구가 불가합니다.')) return;
    if (!currentEventDocId) return;
    try {
        // 본문 문서 먼저 삭제한 뒤 카드 문서 삭제.
        await deleteDoc(doc(db, 'events', currentEventDocId, 'content', 'main')).catch(() => {});
        await deleteDoc(doc(db, 'events', currentEventDocId));
        alert('성공적으로 이벤트가 영구 제거되었습니다.');
        closeEvent();
    } catch (err) {
        alert('이벤트 삭제에 실패했습니다: ' + err.message);
    }
}

export function closeEvent() {
    const eventModal = document.getElementById('event-modal');
    if (eventModal) eventModal.style.display = 'none';
    if (eventCommentsListener) eventCommentsListener();
    if (eventLikeUnsub) { eventLikeUnsub(); eventLikeUnsub = null; }
}

export function listenEvents() {
    if (!timerInterval) {
        timerInterval = setInterval(updateTimerCells, 1000);
    }
    onSnapshot(collection(db, 'events'), (querySnapshot) => {
        events = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            data.docId = docSnap.id;
            events.push(data);
        });
        renderEvents();
    });
}
