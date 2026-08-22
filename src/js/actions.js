// 이벤트 위임 기반 액션 디스패처 (M-7: CSP의 script-src에서 'unsafe-inline' 제거).
//
// [왜 필요한가]
// 마크업 곳곳에 onclick="..." 같은 인라인 핸들러가 63개 있었다. 인라인 핸들러는
// CSP가 script-src에 'unsafe-inline'을 허용해야만 동작하는데, 그 한 가지를 켜는
// 순간 CSP의 핵심 방어(주입된 스크립트 차단)가 통째로 무력화된다 — 어딘가에서
// DOM XSS가 생겨도 CSP가 막아 주지 못한다. 헤더의 나머지 항목(HSTS,
// frame-ancestors, object-src 등)이 잘 갖춰져 있어도 이 하나가 남아 있으면
// 의미가 크게 줄어든다.
//
// [어떻게 바꿨나]
// 각 요소는 이제 "무엇을 하는지"만 data-action으로 선언하고, 실제 함수는 이
// 모듈의 레지스트리에서 찾아 실행한다. 리스너는 document에 단 하나만 걸려 있고
// (클릭 위임), 나중에 동적으로 추가되는 요소도 별도 바인딩 없이 그대로 동작한다.
// 부수 효과로 window 전역 노출 35개도 함께 사라졌다 — 예전에는 인라인 핸들러가
// 함수를 찾을 수 있도록 전역에 올려 둘 수밖에 없었다.
//
// [값 전달]
// 인자가 필요한 액션은 data-* 속성으로 받는다 (예: data-nav="/notice").
// 문자열 하나면 충분한 경우만 있어서 별도의 직렬화 규칙은 두지 않았다.

const registry = new Map();

/** 액션 이름 → 처리 함수. 처리 함수는 (element, event)를 받는다. */
export function registerActions(actions) {
    for (const [name, fn] of Object.entries(actions)) {
        registry.set(name, fn);
    }
}

function onClick(event) {
    // closest를 쓰므로 버튼 안의 아이콘/텍스트를 눌러도 올바르게 잡힌다.
    const el = event.target.closest('[data-action]');
    if (!el) return;

    const fn = registry.get(el.dataset.action);
    if (!fn) {
        // 오타나 등록 누락을 조용히 넘기면 "눌리는데 아무 일도 안 남" 상태가 되어
        // 원인을 찾기 어렵다. 사용자에게는 영향이 없으므로 콘솔로만 알린다.
        console.warn('[actions] 등록되지 않은 액션:', el.dataset.action);
        return;
    }

    // <a> 기본 이동과 폼 제출을 막는다. 지금 모든 액션 요소가 그것을 원한다.
    event.preventDefault();
    fn(el, event);
}

// 이미지 로드 실패 시 대체 처리 (기존 onerror 속성 대체).
// error 이벤트는 버블링하지 않으므로 캡처 단계에서 잡아야 한 곳에서 처리할 수 있다.
function onErrorCapture(event) {
    const el = event.target;
    if (!(el instanceof HTMLImageElement)) return;

    const fallback = el.dataset.fallback;
    if (!fallback) return;

    // 대체 이미지마저 실패하면 다시 error가 나서 무한 반복이 된다. 한 번 처리한
    // 요소는 표시를 지워 재진입을 막는다.
    delete el.dataset.fallback;

    if (fallback === 'hide') {
        el.style.display = 'none';
    } else {
        el.src = fallback;
    }
}

export function initActions() {
    document.addEventListener('click', onClick);
    document.addEventListener('error', onErrorCapture, true);
}
