import { loggedInUser } from './state.js';

export const BASE_PATH = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.mobile-nav a').forEach(a => a.classList.remove('active'));
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.add('active');
    const navId = {
        home: 'nav-home',
        notice: 'nav-notice',
        faq: 'nav-faq',
        members: 'nav-members',
        admin: 'nav-admin',
        login: 'nav-login',
        signup: 'nav-login',
        mypage: 'nav-login'
    }[id];
    const mobileNavId = {
        home: 'mobile-nav-home',
        notice: 'mobile-nav-notice',
        faq: 'mobile-nav-faq',
        members: 'mobile-nav-members',
        admin: 'mobile-nav-admin',
        login: 'mobile-nav-login',
        signup: 'mobile-nav-login',
        mypage: 'mobile-nav-login'
    }[id];
    if (navId && document.getElementById(navId)) document.getElementById(navId).classList.add('active');
    if (mobileNavId && document.getElementById(mobileNavId)) document.getElementById(mobileNavId).classList.add('active');
    window.scrollTo(0, 0);
}

const ROUTES = {
    '/home': { section: 'home' },
    '/notice': { section: 'notice' },
    '/faq': { section: 'faq' },
    '/members': { section: 'members' },
    '/login': { section: 'login', guestOnly: true },
    '/signup': { section: 'signup', guestOnly: true },
    '/mypage': { section: 'mypage', authRequired: true },
    '/admin': { section: 'admin', adminOnly: true },
    '/privacy': { section: 'privacy' },
    '/guidelines': { section: 'guidelines' }
};

export function renderRoute() {
    let path = location.pathname;
    if (BASE_PATH && path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
    if (path === '') path = '/';
    if (path === '/') path = '/home';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    const route = ROUTES[path];
    if (!route) {
        history.replaceState({}, '', '/home');
        return showSection('home');
    }
    const targetHome = BASE_PATH + '/home';
    const targetLogin = BASE_PATH + '/login';
    if (route.guestOnly && loggedInUser) {
        history.replaceState({}, '', targetHome);
        return showSection('home');
    }
    if (route.authRequired && !loggedInUser) {
        history.replaceState({}, '', targetLogin);
        return showSection('login');
    }
    if (route.adminOnly && (!loggedInUser || loggedInUser.role !== 'admin')) {
        history.replaceState({}, '', targetHome);
        return showSection('home');
    }
    showSection(route.section);
}

export function navigateTo(path) {
    const target = BASE_PATH + path;
    if (location.pathname !== target) {
        history.pushState({}, '', target);
    }
    renderRoute();
}

export function handleAuthNavClick() {
    navigateTo(loggedInUser ? '/mypage' : '/login');
}

window.addEventListener('popstate', renderRoute);

// 모바일 메뉴 토글
export function toggleMobileMenu() {
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const mobileNav = document.getElementById('mobile-nav');
    const isOpen = hamburgerMenu?.classList.toggle('active');
    mobileNav?.classList.toggle('active', isOpen);
    document.body.classList.toggle('menu-open', isOpen);
}

// 모바일 메뉴 닫기
export function closeMobileMenu() {
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const mobileNav = document.getElementById('mobile-nav');

    if (hamburgerMenu) hamburgerMenu.classList.remove('active');
    if (mobileNav) mobileNav.classList.remove('active');
    document.body.classList.remove('menu-open');
}
