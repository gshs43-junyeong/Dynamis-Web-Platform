import { doc, getDoc, setDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

function getTrafficDocRef(userId) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return doc(db, 'traffic', `${userId}_${todayStr}`);
}

// 읽기 전용: 현재 카운트를 늘리지 않고 한도 초과 여부만 확인합니다.
// 실제 작업(글 등록 등)을 시도하기 전에 먼저 호출하세요.
// 반환값: { allowed, currentVal, error } - error가 true면 진짜 한도초과가 아니라
// 통신/권한 문제로 확인 자체가 실패한 것이니 호출부에서 구분해서 안내해야 합니다.
export async function checkTrafficAllowed(userId, actionType, sizeOrCount, maxLimit) {
    if (!userId) {
        console.error('트래픽 확인 실패: userId가 없습니다.');
        return { allowed: false, currentVal: 0, error: true, message: '로그인 정보가 없습니다.' };
    }

    try {
        const docSnapshot = await getDoc(getTrafficDocRef(userId));
        const currentVal = docSnapshot.exists() ? (docSnapshot.data()[actionType] || 0) : 0;
        return { allowed: currentVal + sizeOrCount <= maxLimit, currentVal, error: false };
    } catch (error) {
        console.error('트래픽 제어 시스템 통신 장애:', error);
        return { allowed: false, currentVal: 0, error: true, message: error.message };
    }
}

// 실제 작업이 성공적으로 끝난 뒤에만 호출하세요. increment()로 원자적으로 반영합니다.
export async function commitTrafficIncrement(userId, actionType, sizeOrCount) {
    if (!userId) return;

    try {
        await setDoc(getTrafficDocRef(userId), { [actionType]: increment(sizeOrCount) }, { merge: true });
    } catch (error) {
        console.error('트래픽 카운트 반영 실패:', error);
    }
}

// 하위 호환용: 체크와 증가를 한번에 수행합니다.
// 이후에 실패할 수 있는 작업(addDoc 등)이 남아있다면 대신 checkTrafficAllowed + commitTrafficIncrement를 나눠서 쓰세요.
export async function verifyAndIncrementTraffic(userId, actionType, sizeOrCount, maxLimit) {
    const result = await checkTrafficAllowed(userId, actionType, sizeOrCount, maxLimit);
    if (!result.allowed) return false;
    await commitTrafficIncrement(userId, actionType, sizeOrCount);
    return true;
}
