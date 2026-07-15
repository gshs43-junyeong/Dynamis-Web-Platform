import { db, auth as firebaseAuth } from './firebase-config.js';
import { verifyAndIncrementTraffic, checkTrafficAllowed, commitTrafficIncrement } from './traffic.js';
import {
    collection,
    doc,
    onSnapshot,
    query,
    addDoc,
    updateDoc,
    deleteDoc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ITEMS_PER_PAGE, formatAuthorLabel, getByteLength } from './utils.js';
import { loggedInUser, ensureAdminAction } from './state.js';

let notices = [];
let displayNoticesGlobal = [];
let currentNoticeDocId = null;
let commentsSnapshotListener = null;
let currentPage = 1;

export async function addNotice() {
    const titleInput = document.getElementById('post-title');
    const contentInput = document.getElementById('post-content');
    const fileInput = document.getElementById('post-file');

    const title = titleInput?.value.trim();
    const content = contentInput?.value.trim();
    if (!title || !content) return alert('제목과 내용을 빠짐없이 기입해 주세요.');
    if (!loggedInUser) return alert('인증 세션이 만료되었습니다.');

    const needsNoticeTrafficCheck = loggedInUser.role !== 'admin';
    if (needsNoticeTrafficCheck) {
        const contentBytes = getByteLength(content);
        if (contentBytes > 2000) {
            alert(`❌ [바이트 초과] 공지사항 본문 크기가 2000바이트를 초과하여 게시할 수 없습니다. (현재: ${contentBytes}바이트)`);
            return;
        }

        const noticeTrafficResult = await checkTrafficAllowed(firebaseAuth.currentUser?.uid, 'noticeCount', 1, 5);
        if (!noticeTrafficResult.allowed) {
            if (noticeTrafficResult.error) {
                alert('⚠️ 작성 가능 여부를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n(' + (noticeTrafficResult.message || '') + ')');
            } else {
                alert('❌ [작성 빈도 제한] 악성 트래픽 및 오뷰즈 방어 정책에 의해 하루 최대 공지사항 작성 한도(5회)를 초과하여 차단되었습니다.');
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
    const noticePayload = {
        title,
        content,
        authorName: loggedInUser.name,
        authorBatch: loggedInUser.batch,
        authorRole: loggedInUser.role,
        authorId: firebaseAuth.currentUser?.uid,
        date,
        pinned: false,
        files: uploadedFilesArray,
        timestamp: Date.now()
    };

    try {
        await addDoc(collection(db, 'notices'), noticePayload);
        if (needsNoticeTrafficCheck) {
            await commitTrafficIncrement(firebaseAuth.currentUser?.uid, 'noticeCount', 1);
        }
        if (needsUploadTrafficCheck) {
            await commitTrafficIncrement(firebaseAuth.currentUser?.uid, 'uploadBytes', totalNewSize);
        }
        if (titleInput) titleInput.value = '';
        if (contentInput) contentInput.value = '';
        if (fileInput) fileInput.value = '';
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

    displayNoticesGlobal = [...notices].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
    renderNoticePage(currentPage);
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
        titleTd.textContent = `${n.pinned ? '📌 [고정] ' : ''}${n.title || ''}${n.files && n.files.length ? ' 📎' : ''}`;
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
    const n = displayNoticesGlobal[index];
    if (!n) return;
    currentNoticeDocId = n.docId;

    const modalTitle = document.getElementById('modal-title');
    const modalAuthor = document.getElementById('modal-author');
    const modalDate = document.getElementById('modal-date');
    const modalText = document.getElementById('modal-text');
    const modalDeleteBtn = document.getElementById('modal-delete-btn');
    const fileBox = document.getElementById('modal-file-box');
    const fileListContainer = document.getElementById('modal-file-list');

    if (modalTitle) modalTitle.innerText = n.title;
    if (modalAuthor) modalAuthor.innerText = `✍️ ${formatAuthorLabel(n)}`;
    if (modalDate) modalDate.innerText = `📅 ${n.date}`;
    if (modalText) modalText.innerText = n.content;

    if (modalDeleteBtn) modalDeleteBtn.style.display = (loggedInUser && loggedInUser.role === 'admin') ? 'block' : 'none';

    if (fileListContainer) fileListContainer.innerHTML = '';
    const filesToRender = n.files || [];

    if (filesToRender.length > 0) {
        if (fileBox) fileBox.style.display = 'block';
        filesToRender.forEach((fObj) => {
            const link = document.createElement('a');
            link.className = 'file-item-link';
            link.href = '#';
            link.innerText = `📄 ${fObj.fileName} 다운로드`;
            link.onclick = (e) => {
                e.preventDefault();
                executeFileDownloadSecure(e, fObj.fileSize, fObj.fileData, fObj.fileName);
            };
            fileListContainer.appendChild(link);
        });
    } else {
        if (fileBox) fileBox.style.display = 'none';
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

export async function addComment() {
    if (!loggedInUser) return alert('로그인이 풀렸습니다.');
    const input = document.getElementById('comment-input');
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
                alert('❌ [작성 빈도 제한] 악성 트래픽 방어 정책에 의해 하루 최대 댓글 작성 가능 횟수(10회)를 초과하여 차단되었습니다.');
            }
            return;
        }
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    try {
        await addDoc(collection(doc(db, 'notices', currentNoticeDocId), 'comments'), {
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

export async function deleteCurrentNotice() {
    if (!ensureAdminAction()) return;
    if (!confirm('정말 이 공지사항을 삭제 처리 하시겠습니까? 복구가 불가합니다.')) return;
    if (!currentNoticeDocId) return;
    try {
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
    });
}
