// 읽기 진행 바 + "맨 위로" 버튼.
//
// 홈 소개 글과 공지 본문이 길어지면서 지금 어디쯤 읽고 있는지 알기 어려웠다.
// 스크롤 이벤트는 rAF로 묶어 프레임당 한 번만 계산한다.
let progressBar = null;
let topButton = null;
let ticking = false;

const TOP_BUTTON_THRESHOLD = 420;

function update() {
    ticking = false;
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const scrollable = (doc.scrollHeight - window.innerHeight) || 0;
    const ratio = scrollable > 0 ? Math.min(scrollTop / scrollable, 1) : 0;

    if (progressBar) progressBar.style.transform = `scaleX(${ratio})`;
    if (topButton) topButton.classList.toggle('visible', scrollTop > TOP_BUTTON_THRESHOLD);
}

function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
}

export function scrollToTop() {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

export function initScrollUI() {
    progressBar = document.getElementById('scroll-progress-bar');
    topButton = document.getElementById('scroll-top-btn');
    if (!progressBar && !topButton) return;

    topButton?.addEventListener('click', scrollToTop);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
}
