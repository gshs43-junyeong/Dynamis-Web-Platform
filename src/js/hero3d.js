// 홈 화면 입체 연출의 동작 부분. 스타일은 css/partials/depth.css 참고.
//
// [설계] JS는 각도와 커서 위치만 CSS 변수로 넘기고, 실제 시차(parallax)는
// 브라우저의 원근 투영에 맡긴다. 무대(.hero-stage-inner)를 몇 도 돌리면 그 안의
// 도형들이 각자의 translateZ 깊이에 비례해 저절로 다른 거리만큼 움직인다 —
// 층마다 이동량을 계산해 개별로 transform을 쓰는 방식보다 코드가 단순하고,
// 합성 레이어도 하나로 유지되어 더 가볍다.
//
// [성능] 포인터 이벤트는 그대로 두면 초당 수백 번 들어오므로 rAF로 한 프레임에
// 한 번만 스타일을 쓴다. 스크롤도 같은 방식이며 passive 리스너를 쓴다.

// 기울기 상한. 크게 주면 정보를 읽는 화면이 장난스러워져서 일부러 낮게 잡았다.
const STAGE_MAX_DEG = 7;
const CARD_MAX_DEG = 3.2;
// 스크롤에 따라 무대가 아주 조금 떠내려가는 양(px). 히어로가 화면 밖으로
// 나가기까지의 구간에만 적용한다.
const STAGE_SCROLL_DRIFT = 90;

const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 마우스가 있는 환경에서만 시차를 건다. 터치 기기에서는 hover 상태가 없어
// "기울었다가 안 돌아오는" 어색한 상태로 남기 쉽다.
const hasFinePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** rAF로 묶어서 한 프레임에 한 번만 실행되는 함수를 만든다. */
function rafThrottle(fn) {
    let queued = false;
    let lastArgs = null;
    return (...args) => {
        lastArgs = args;
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            fn(...lastArgs);
        });
    };
}

/** 히어로 무대: 커서 위치 → 무대 회전, 스크롤 → 세로 드리프트 */
function initHeroStage() {
    const stage = document.querySelector('.hero-stage');
    const inner = document.querySelector('.hero-stage-inner');
    if (!stage || !inner) return;

    if (hasFinePointer()) {
        const onMove = rafThrottle((clientX, clientY) => {
            // 뷰포트 중심을 원점으로 한 -1..1 정규화 좌표.
            // 화면 어디에 있든 히어로가 반응하게 하려고 무대 박스가 아니라
            // 뷰포트 기준으로 잡는다(무대는 화면보다 넓어서 박스 기준으로 하면
            // 가장자리에서 값이 포화된다).
            const nx = (clientX / window.innerWidth) * 2 - 1;
            const ny = (clientY / window.innerHeight) * 2 - 1;
            // 커서가 오른쪽이면 무대가 왼쪽을 보도록(=오른쪽으로 회전) 부호를 맞춘다.
            inner.style.setProperty('--ry', `${(nx * STAGE_MAX_DEG).toFixed(2)}deg`);
            inner.style.setProperty('--rx', `${(-ny * STAGE_MAX_DEG * 0.6).toFixed(2)}deg`);
        });
        window.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            onMove(e.clientX, e.clientY);
        }, { passive: true });

        // 창 밖으로 나가면 원위치. transition이 걸려 있어 부드럽게 풀린다.
        document.addEventListener('mouseleave', () => {
            inner.style.setProperty('--rx', '0deg');
            inner.style.setProperty('--ry', '0deg');
        });
    }

    const onScroll = rafThrottle(() => {
        const rect = stage.getBoundingClientRect();
        // 무대가 화면 위로 완전히 빠져나가면 더 계산하지 않는다.
        if (rect.bottom < 0) return;
        const progress = Math.min(Math.max(-rect.top / window.innerHeight, 0), 1);
        inner.style.setProperty('--sy', `${(progress * STAGE_SCROLL_DRIFT).toFixed(1)}px`);
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}

/** 카드: 커서를 따라 살짝 기울고, 커서 위치에 광택이 따라붙는다. */
function initCardTilt() {
    if (!hasFinePointer()) return;

    // 대시보드(상호작용이 많은 데이터 패널)와 영상 카드는 제외한다.
    // 특히 iframe은 3D 변환된 조상 안에서 합성/클릭 판정이 어긋나는 경우가 있어
    // 기울이지 않는 편이 안전하다.
    const cards = Array.from(document.querySelectorAll('#home .content-card')).filter(
        (el) => !el.id && !el.querySelector('iframe')
    );
    if (!cards.length) return;

    cards.forEach((card) => {
        card.classList.add('card3d');

        const onMove = rafThrottle((clientX, clientY) => {
            const r = card.getBoundingClientRect();
            const px = (clientX - r.left) / r.width;   // 0..1
            const py = (clientY - r.top) / r.height;   // 0..1
            card.style.setProperty('--ty', `${((px - 0.5) * 2 * CARD_MAX_DEG).toFixed(2)}deg`);
            card.style.setProperty('--tx', `${(-(py - 0.5) * 2 * CARD_MAX_DEG).toFixed(2)}deg`);
            card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
            card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        });

        card.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            onMove(e.clientX, e.clientY);
        }, { passive: true });

        card.addEventListener('pointerenter', (e) => {
            if (e.pointerType !== 'mouse') return;
            card.classList.add('is-tilting');
        });

        card.addEventListener('pointerleave', () => {
            card.classList.remove('is-tilting');
            card.style.setProperty('--tx', '0deg');
            card.style.setProperty('--ty', '0deg');
        });
    });
}

/* 매개변수 곡면에 실시간으로 파동을 흘려보낸다.
 *
 * 마크업에 박혀 있는 path는 위상 t=0인 정지 상태이고(tools/build_hero_geometry.js가
 * 생성), 여기서 매 프레임 z = sin(u + t)·cos(v)를 다시 계산해 d 속성을 갱신한다.
 * t가 증가하면 마루와 골이 u 방향으로 이동해 파동이 지나가는 것처럼 보인다.
 *
 * [매 프레임 비용을 어떻게 줄였나]
 * 정직하게 짜면 꼭짓점마다 sin/cos를 호출하게 되는데(11×11×2 = 242회), 삼각함수를
 * 상수로 분리하면 프레임당 2회로 줄일 수 있다:
 *
 *     sin(u + t) = sin(u)·cos(t) + cos(u)·sin(t)
 *
 * sin(u), cos(u), cos(v)는 t와 무관하므로 미리 구해 둔다. 등각 투영의 화면x와
 * 화면y의 z 무관 성분도 마찬가지로 상수라 미리 계산해 둔다. 결과적으로 프레임당
 * 꼭짓점 하나에 곱셈 몇 번과 뺄셈 하나만 남는다.
 *
 * [언제 도는가]
 * IntersectionObserver로 무대가 화면에 보일 때만 루프를 돌린다. 홈이 아닌 탭으로
 * 이동하면 무대가 display:none이 되어 교차하지 않으므로 같은 장치로 함께 멈춘다.
 * 탭 자체가 백그라운드로 가면 rAF가 알아서 멈춘다. */
function initSurfaceWave() {
    const svg = document.querySelector('.hero-geo-surface');
    if (!svg) return;

    // 곡면 파라미터는 마크업이 단일 출처다(생성기가 data-*로 실어 보낸다).
    const span = parseFloat(svg.dataset.span);
    const cells = parseInt(svg.dataset.cells, 10);
    const amp = parseFloat(svg.dataset.amp);
    if (!Number.isFinite(span) || !Number.isFinite(cells) || !Number.isFinite(amp)) return;

    const paths = svg.querySelectorAll('path');
    // 생성기는 u방향 (cells+1)개 + v방향 (cells+1)개를 이 순서로 낸다.
    if (paths.length !== (cells + 1) * 2) return;

    const n = cells;
    const COS30 = Math.cos(Math.PI / 6);
    const SIN30 = Math.sin(Math.PI / 6);
    const stepW = (span * 2) / n;

    // t와 무관한 값들을 미리 계산한다.
    const sinU = new Float64Array(n + 1);
    const cosU = new Float64Array(n + 1);
    const cosV = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2 - Math.PI;
        sinU[k] = Math.sin(a);
        cosU[k] = Math.cos(a);
        cosV[k] = Math.cos(a);
    }
    // 꼭짓점(i,j)의 화면 좌표 중 z에 영향받지 않는 성분
    const sx = new Float64Array((n + 1) * (n + 1));
    const byBase = new Float64Array((n + 1) * (n + 1));
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
            const x = -span + i * stepW;
            const y = -span + j * stepW;
            const idx = i * (n + 1) + j;
            sx[idx] = (x - y) * COS30;
            byBase[idx] = (x + y) * SIN30;
        }
    }

    const round1 = (v) => Math.round(v * 10) / 10;
    let rafId = null;
    const start = performance.now();

    function frame(now) {
        // 약 9초에 한 주기. 기어(12초)와 서로 배수 관계가 아니라서 둘의 위상이
        // 계속 어긋나며 전체가 규칙적으로 반복되는 느낌을 피한다.
        const t = ((now - start) / 9000) * Math.PI * 2;
        const cosT = Math.cos(t);
        const sinT = Math.sin(t);

        // u방향 능선
        for (let i = 0; i <= n; i++) {
            const zRow = (sinU[i] * cosT + cosU[i] * sinT) * amp;
            let d = '';
            for (let j = 0; j <= n; j++) {
                const idx = i * (n + 1) + j;
                d += (j === 0 ? 'M' : ' L') + round1(sx[idx]) + ',' + round1(byBase[idx] - zRow * cosV[j]);
            }
            paths[i].setAttribute('d', d);
        }
        // v방향 능선 (같은 꼭짓점을 반대 순서로 잇는다)
        for (let j = 0; j <= n; j++) {
            let d = '';
            for (let i = 0; i <= n; i++) {
                const idx = i * (n + 1) + j;
                const z = (sinU[i] * cosT + cosU[i] * sinT) * amp * cosV[j];
                d += (i === 0 ? 'M' : ' L') + round1(sx[idx]) + ',' + round1(byBase[idx] - z);
            }
            paths[n + 1 + j].setAttribute('d', d);
        }
        rafId = requestAnimationFrame(frame);
    }

    const observer = new IntersectionObserver((entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && rafId === null) {
            rafId = requestAnimationFrame(frame);
        } else if (!visible && rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    });
    observer.observe(svg);
}

export function initHero3D() {
    // 모션 최소화 설정에서는 CSS 쪽에서 이미 정적으로 고정하지만, 여기서도
    // 리스너 자체를 붙이지 않아 불필요한 연산을 아예 만들지 않는다.
    if (prefersReducedMotion()) return;
    initHeroStage();
    initCardTilt();
    initSurfaceWave();
}
