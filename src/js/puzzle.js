// puzzle.js - 푸터 "심심하세요?" 버튼 → 퍼즐(ARG) 사이트 리다이렉트
//
// 퍼즐 사이트는 별도 리포지토리로 배포됩니다.
// 배포가 끝나면 아래 PUZZLE_URL 한 줄만 채우면 버튼이 활성화됩니다.
//   예) const PUZZLE_URL = 'https://gshs43-junyeong.github.io/dynamis-puzzle/';
const PUZZLE_URL = '';

// 아주 관찰력 좋은 방문자를 위한 작은 떡밥. (개발자 도구를 여는 사람들 몫)
const WHISPER = [
    '%c> 심심한가?',
    'color:#7CFF6B;font-family:monospace;font-size:13px;'
];

export function openPuzzle() {
    if (!PUZZLE_URL) {
        // 아직 통로가 열리지 않음: 조용히 흔들리기만 한다.
        console.log(...WHISPER);
        const btn = document.getElementById('idle-puzzle-btn');
        if (btn) {
            btn.classList.remove('idle-shake');
            // 리플로우를 강제해 애니메이션을 재시작
            void btn.offsetWidth;
            btn.classList.add('idle-shake');
        }
        return;
    }
    window.open(PUZZLE_URL, '_blank', 'noopener,noreferrer');
}
