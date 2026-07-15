import { db, auth as firebaseAuth } from './firebase-config.js';
import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    updateDoc,
    deleteDoc,
    increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getRoleLabel } from './utils.js';
import { loggedInUser, ensureAdminAction } from './state.js';
import { applyUserSessionUI } from './session.js';
import { purgeUserOwnedData } from './auth.js';

let latestUsersSnapshotDocs = null;

export function listenAdminUserConsole() {
    onSnapshot(collection(db, 'users'), (snapshot) => {
        latestUsersSnapshotDocs = snapshot.docs;
        renderAdminUserConsole();
    });
}

export function renderAdminUserConsole() {
    const tbody = document.getElementById('admin-user-list');
    if (!tbody) return;

    if (!loggedInUser || loggedInUser.role !== 'admin') {
        tbody.innerHTML = '';
        return;
    }

    if (!latestUsersSnapshotDocs) return;

    tbody.innerHTML = '';

    latestUsersSnapshotDocs.forEach((docSnap) => {
            const u = docSnap.data();
            const tr = document.createElement('tr');

            const infoTd = document.createElement('td');
            const strong = document.createElement('strong');
            strong.textContent = u.name || '';
            infoTd.appendChild(strong);
            infoTd.appendChild(document.createTextNode(' '));

            const idSpan = document.createElement('span');
            idSpan.style.color = '#666';
            idSpan.style.fontSize = '0.85rem';
            idSpan.textContent = `(${u.id || ''})`;
            infoTd.appendChild(idSpan);
            infoTd.appendChild(document.createElement('br'));

            const warnSpan = document.createElement('span');
            warnSpan.style.color = '#ffaa00';
            warnSpan.style.fontSize = '0.8rem';
            warnSpan.style.fontWeight = 'bold';
            warnSpan.textContent = `⚠️ 경고 ${String(u.warnings || 0)}회`;
            infoTd.appendChild(warnSpan);

            const roleTd = document.createElement('td');
            const roleLabel = document.createElement('span');
            roleLabel.style.fontWeight = 'bold';
            roleLabel.style.color = '#fff';
            roleLabel.textContent = getRoleLabel(u.role);
            roleTd.appendChild(roleLabel);

            const selectTd = document.createElement('td');
            const roleSelect = document.createElement('select');
            roleSelect.style.background = '#0a0a0a';
            roleSelect.style.color = '#fff';
            roleSelect.style.border = '1px solid #444';
            roleSelect.style.padding = '5px';
            roleSelect.style.borderRadius = '4px';
            roleSelect.style.width = 'auto';
            roleSelect.style.marginBottom = '0';
            ['general', 'honored', 'member', 'admin'].forEach((roleValue) => {
                const option = document.createElement('option');
                option.value = roleValue;
                option.textContent = roleValue === 'general' ? '등급 없음 (general)' : roleValue === 'honored' ? '명예부원 (honored)' : roleValue === 'member' ? '부원 (member)' : '관리자 (admin)';
                if (u.role === roleValue) option.selected = true;
                roleSelect.appendChild(option);
            });
            selectTd.appendChild(roleSelect);

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.textContent = '변경 확정';
            confirmBtn.style.padding = '5px 12px';
            confirmBtn.style.marginLeft = '8px';
            confirmBtn.style.background = '#fff';
            confirmBtn.style.color = '#000';
            confirmBtn.style.border = 'none';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.style.fontWeight = 'bold';
            confirmBtn.style.borderRadius = '3px';
            confirmBtn.addEventListener('click', () => commitRoleChange(u.uid, roleSelect.value));
            selectTd.appendChild(confirmBtn);

            const actionTd = document.createElement('td');
            actionTd.style.textAlign = 'left';
            const warnBtn = document.createElement('button');
            warnBtn.type = 'button';
            warnBtn.className = 'btn-mini btn-warn';
            warnBtn.textContent = '경고 조치';
            warnBtn.addEventListener('click', () => warnUser(u.uid));

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn-mini btn-del';
            deleteBtn.textContent = '계정 삭제';
            deleteBtn.addEventListener('click', () => deleteUserByAdmin(u.uid, u.id));

            actionTd.appendChild(warnBtn);
            actionTd.appendChild(deleteBtn);

            tr.appendChild(infoTd);
            tr.appendChild(roleTd);
            tr.appendChild(selectTd);
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
    });
}

export async function commitRoleChange(userId, targetRole) {
    if (!ensureAdminAction()) return;
    const roleToApply = targetRole || (() => {
        const selectElement = document.getElementById(`role-select-${userId}`);
        return selectElement ? selectElement.value : null;
    })();
    if (!roleToApply) return;
    console.log('[Admin Debug] commitRoleChange 대상 userId:', userId);
    console.log('[Admin Debug] 관리자 본인 firebaseAuth.currentUser?.uid:', firebaseAuth.currentUser?.uid);
    console.log('[Admin Debug] 관리자 본인 loggedInUser.role:', loggedInUser?.role);
    try {
        await updateDoc(doc(db, 'users', userId), { role: roleToApply });
        alert('해당 회원의 등급 권한이 성공적으로 업데이트되었습니다.');
        if (loggedInUser && firebaseAuth.currentUser?.uid === userId) {
            const userSnapshot = await getDoc(doc(db, 'users', userId));
            if (userSnapshot.exists()) applyUserSessionUI(userSnapshot.data());
        }
    } catch (err) {
        console.error('[Admin Debug] commitRoleChange 에러 상세:', err.code, err.message);
        alert('등급 변경에 실패했습니다: ' + err.message);
    }
}

export async function warnUser(userId) {
    if (!ensureAdminAction()) return;
    if (!confirm('이 유저에게 경고 1회를 누적하겠습니까?')) return;
    console.log('[Admin Debug] warnUser 대상 userId:', userId);
    console.log('[Admin Debug] 관리자 본인 firebaseAuth.currentUser?.uid:', firebaseAuth.currentUser?.uid);
    console.log('[Admin Debug] 관리자 본인 loggedInUser.role:', loggedInUser?.role);
    try {
        await firebaseAuth.currentUser?.getIdToken(true);
        await updateDoc(doc(db, 'users', userId), { warnings: increment(1), hasUnseenWarning: true });
        alert('경고가 부여되었습니다.');
    } catch (err) {
        console.error('[Admin Debug] warnUser 에러 상세:', err.code, err.message);
        alert('경고 부여에 실패했습니다: ' + err.message);
    }
}

export async function deleteUserByAdmin(userId, usernameId) {
    if (!ensureAdminAction()) return;
    if (!confirm('⚠️ 이 유저를 강제 탈퇴시키겠습니까? 삭제한 이후 복구가 불가합니다.')) return;

    // 대상이 작성한 부가 데이터(공지/이벤트/댓글)를 best-effort로 정리한다.
    // (트래픽 통계는 규칙상 본인만 읽을 수 있어 관리자가 지울 수 없으므로 제외)
    await purgeUserOwnedData(userId, { includeTraffic: false });

    try {
        // 관리자 권한으로 토큰을 새로 발급(role 반영) 후 삭제.
        await firebaseAuth.currentUser?.getIdToken(true);
        await deleteDoc(doc(db, 'users', userId));
        if (usernameId) {
            try {
                await deleteDoc(doc(db, 'usernames', usernameId));
            } catch (unameErr) {
                console.warn('[Admin] usernames 문서 삭제 실패(이미 없을 수 있음):', unameErr.message);
            }
        }
        alert('계정 삭제를 완료했습니다. (해당 사용자의 Firebase 로그인 계정 자체는 관리자가 지울 수 없어, 본인이 재로그인하면 미가입 상태로 처리됩니다.)');
    } catch (err) {
        alert('계정 삭제에 실패했습니다: ' + err.message);
    }
}
