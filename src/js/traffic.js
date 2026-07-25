import { doc, getDoc, setDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, auth } from './firebase-config.js';
import { serverNow } from './clock.js';

// 일일 트래픽 카운터.
//
// [왜 구조가 바뀌었나]
// 예전에는 traffic/{uid}_{YYYY-MM-DD} 문서에 클라이언트가 "알아서" 카운터를 올렸다.
// 즉 글쓰기와 카운터 증가가 별개의 쓰기라, 공격자는 그냥 카운터 증가를 호출하지
// 않으면 한도를 무제한으로 우회할 수 있었다(규칙은 traffic 문서를 보지 않았다).
//
// 이제는 규칙이 getAfter()로 "배치 커밋 후"의 카운터를 확인해서, 글쓰기 자체를
// "같은 배치 안에서 카운터가 정확히 +1 되었을 것"에 묶는다. 카운터를 빼먹은 단독
// 쓰기는 서버가 거부한다. 그래서 카운터 증가는 반드시 본문 쓰기와 같은
// writeBatch 안에 들어가야 한다 (stageQuota 참고).
//
// 문서 ID가 traffic/{uid} 로 바뀐 이유: 규칙 안에서 'YYYY-MM-DD' 문자열을 만들 수
// 없기 때문(zero-padding 불가)에, 날짜를 y/m/d 정수 필드로 들고 비교한다.
// 덤으로 사용자당 문서가 하나로 유지되어 날짜별 문서가 쌓이지 않는다.

export function trafficDocRef(userId) {
    return doc(db, 'traffic', userId);
}

// 규칙의 KST 판정(request.time + 9h)과 반드시 같은 기준이어야 한다.
// 기기 시계가 틀어져 있으면 서버와 날짜가 어긋나 거부되므로, clock.js가 측정한
// 서버 시각 보정치를 적용한 serverNow()를 쓴다.
function kstToday() {
    const d = new Date(serverNow() + 9 * 3600 * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function isSameDay(data, today) {
    return !!data && data.y === today.y && data.m === today.m && data.d === today.d;
}

// 오늘자 카운터 상태를 읽는다. 날짜가 지났으면 (리셋 대상이므로) 카운트는 0으로 본다.
export async function readTrafficState(userId) {
    const today = kstToday();
    if (!userId) {
        return { ok: false, message: '로그인 정보가 없습니다.', today, isToday: false, counts: {} };
    }
    try {
        const snap = await getDoc(trafficDocRef(userId));
        const data = snap.exists() ? snap.data() : null;
        const isToday = isSameDay(data, today);
        return { ok: true, today, isToday, counts: isToday ? data : {} };
    } catch (error) {
        console.error('트래픽 제어 시스템 통신 장애:', error);
        return { ok: false, message: error.message, today, isToday: false, counts: {} };
    }
}

export function currentCount(state, field) {
    return state.counts?.[field] || 0;
}

// 한도 초과 여부(선반영 검사). 최종 판정은 서버 규칙이 한다.
export function withinLimit(state, field, delta, maxLimit) {
    return currentCount(state, field) + delta <= maxLimit;
}

// 카운터 증가를 배치에 실어 보낸다. 반드시 본문 쓰기와 같은 배치여야 한다.
//   - 오늘자 문서가 이미 있으면 increment()로 원자적 +1 (동시 탭 경합에도 안전)
//   - 날짜가 바뀌었으면 문서를 통째로 덮어써 전 항목을 리셋
export function stageQuota(batch, userId, state, deltas) {
    const ref = trafficDocRef(userId);
    if (state.isToday) {
        const payload = { ...state.today };
        for (const [field, delta] of Object.entries(deltas)) {
            payload[field] = increment(delta);
        }
        batch.set(ref, payload, { merge: true });
        return;
    }
    batch.set(ref, { ...state.today, ...deltas });
}

// 다운로드 누적량. 다운로드는 "읽기"라서 서버 규칙이 카운터 증가를 강제할 수 없다
// (쓰기가 아니므로 getAfter로 묶을 대상이 없음). 따라서 이 수치는 강제력이 없는
// 참고용 통계이며, 우회하려는 사용자는 얼마든지 우회할 수 있다.
export async function recordAdvisoryUsage(userId, field, amount) {
    if (!userId) return;
    try {
        const state = await readTrafficState(userId);
        const ref = trafficDocRef(userId);
        if (state.isToday) {
            await setDoc(ref, { ...state.today, [field]: increment(amount) }, { merge: true });
        } else {
            await setDoc(ref, { ...state.today, [field]: amount });
        }
    } catch (error) {
        console.error('트래픽 카운트 반영 실패:', error);
    }
}

// 다운로드 한도(참고용) 확인 + 반영.
export async function checkAndRecordDownload(userId, bytes, maxLimit) {
    const state = await readTrafficState(userId);
    if (!state.ok) return false;
    if (!withinLimit(state, 'downloadBytes', bytes, maxLimit)) return false;
    await recordAdvisoryUsage(userId, 'downloadBytes', bytes);
    return true;
}

export { auth };
