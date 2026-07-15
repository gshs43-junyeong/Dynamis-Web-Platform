import { db, auth as firebaseAuth } from './firebase-config.js';
import { collection, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loggedInUser } from './state.js';

// 재사용 하트(좋아요) 위젯.
// - 한 계정당 한 번만 누를 수 있고, 한 번 누르면 취소 불가 (규칙에서 update/delete 금지).
// - 좋아요 여부/개수는 likes 하위 컬렉션(docId == 누른 사람 uid)을 실시간 구독해 표시.
//
// parentSegments: 대상 문서 경로 조각. 예) ['notices', docId], ['events', docId],
//                 ['faqs', docId], ['users', uid]
// 반환값: onSnapshot 해제 함수 (모달을 닫을 때 호출).
export function renderLikeWidget(mountEl, parentSegments) {
    if (!mountEl) return () => {};
    mountEl.innerHTML = '';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'like-btn';

    const heart = document.createElement('span');
    heart.className = 'like-heart';
    heart.textContent = '🤍';

    const count = document.createElement('span');
    count.className = 'like-count';
    count.textContent = '0';

    btn.appendChild(heart);
    btn.appendChild(count);
    mountEl.appendChild(btn);

    let liked = false;

    const likesCol = collection(db, ...parentSegments, 'likes');
    const unsub = onSnapshot(likesCol, (snap) => {
        count.textContent = String(snap.size);
        const uid = firebaseAuth.currentUser?.uid;
        liked = !!(uid && snap.docs.some((d) => d.id === uid));
        heart.textContent = liked ? '❤️' : '🤍';
        btn.classList.toggle('liked', liked);
        btn.disabled = !loggedInUser || liked;
        btn.title = !loggedInUser
            ? '로그인 후 좋아요를 누를 수 있습니다.'
            : liked
                ? '이미 좋아요를 눌렀습니다. (취소 불가)'
                : '좋아요';
    }, (err) => {
        console.warn('[Likes] 구독 실패:', err?.message || err);
    });

    btn.addEventListener('click', async () => {
        const uid = firebaseAuth.currentUser?.uid;
        if (!loggedInUser || !uid) {
            alert('로그인 후 좋아요를 누를 수 있습니다.');
            return;
        }
        if (liked) {
            alert('이미 좋아요를 누르셨습니다. 좋아요는 취소할 수 없습니다.');
            return;
        }
        // 낙관적 잠금: 중복 클릭 방지.
        btn.disabled = true;
        try {
            await setDoc(doc(db, ...parentSegments, 'likes', uid), {
                uid,
                timestamp: Date.now()
            });
        } catch (err) {
            btn.disabled = false;
            alert('좋아요 처리에 실패했습니다: ' + (err?.message || err));
        }
    });

    return unsub;
}
