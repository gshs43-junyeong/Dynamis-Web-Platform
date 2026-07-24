export function initScrollReveal() {
    const targets = document.querySelectorAll('#home .content-card');
    if (!targets.length) return;

    targets.forEach((el) => el.classList.add('scroll-reveal'));

    if (!('IntersectionObserver' in window)) {
        targets.forEach((el) => el.classList.add('is-visible'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });

    targets.forEach((el) => observer.observe(el));
}
