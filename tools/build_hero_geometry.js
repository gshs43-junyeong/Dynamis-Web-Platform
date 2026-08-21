#!/usr/bin/env node
/* 홈 히어로 3D 무대의 기술 도형 생성기.
 *
 * 결과 SVG 마크업은 src/partials/home.html 안에 이미 박혀 있으므로, 도형의 모양이나
 * 밀도를 바꿀 때만 다시 돌려서 해당 블록을 교체하면 된다.
 *
 *     node tools/build_hero_geometry.js          # 표준출력으로 마크업
 *     node tools/build_hero_geometry.js -o out.html
 *
 * [왜 생성하는가]
 * 기어 톱니와 곡면 격자를 손으로 찍으면 간격이 미세하게 어긋난다. 이 동아리 사이트에서
 * 그 어긋남은 단순한 미관 문제가 아니라 "공학적 정밀함"이라는 인상 자체를 깎아먹는다.
 * 좌표를 수식으로 뽑으면 톱니 간격과 격자가 실제로 균일해진다.
 *
 * [왜 SVG를 커밋해 두는가]
 * public/icons의 PNG와 같은 방침이다. 빌드 시점에 생성하면 Vite 설정과 빌드 의존성이
 * 늘어나는데, 이 도형은 자주 바뀌지 않으므로 결과물을 저장소에 두는 편이 단순하다.
 *
 * [도형이 뜻하는 것]
 * 장식으로 아무 모양이나 고른 게 아니라 figure1/figure2의 도해 언어를 어두운 배경으로
 * 옮긴 것이다 — 인볼류트 기어(동역학), z=sin(u)cos(v) 매개변수 곡면(수학), 좌표축과
 * 치수선(설계). 배치와 깊이(translateZ)는 css/partials/depth.css가 담당한다.
 */

const f = (n) => Number(n.toFixed(1));

/* 인볼류트 기어의 실제 치형(involute curve)까지 그리면 path가 수 배로 길어지는데,
 * 화면에서는 실루엣만 보이므로 톱니 하나를 사다리꼴(뿌리원→이끝원→이끝원→뿌리원)로
 * 근사한다. 이끝을 이뿌리보다 좁게 잡아야 기어처럼 읽힌다. */
function gearPath(rOuter, rRoot, teeth) {
    const pts = [];
    const step = (Math.PI * 2) / teeth;
    const tipHalf = step * 0.18;
    const rootHalf = step * 0.30;
    for (let i = 0; i < teeth; i++) {
        const a = i * step;
        const at = (r, ang) => `${f(r * Math.cos(ang))},${f(r * Math.sin(ang))}`;
        pts.push(at(rRoot, a - rootHalf), at(rOuter, a - tipHalf), at(rOuter, a + tipHalf), at(rRoot, a + rootHalf));
    }
    return 'M' + pts.join(' L') + ' Z';
}

/* z = sin(u)·cos(v) 곡면을 등각 투영(isometric)으로 2D path 집합으로 편다.
 * 화면x = (x-y)·cos30, 화면y = (x+y)·sin30 - z */
function surfaceMesh(halfSpan, cells, amp) {
    const COS30 = Math.cos(Math.PI / 6);
    const SIN30 = Math.sin(Math.PI / 6);
    const project = (x, y, z) => `${f((x - y) * COS30)},${f((x + y) * SIN30 - z)}`;
    const n = cells;
    const stepW = (halfSpan * 2) / n;
    // 격자 인덱스를 -PI..PI로 정규화해 파형이 격자 안에 딱 떨어지게 한다.
    const zAt = (i, j) => Math.sin((i / n) * Math.PI * 2 - Math.PI) * Math.cos((j / n) * Math.PI * 2 - Math.PI) * amp;
    const paths = [];
    for (let i = 0; i <= n; i++) {
        const seg = [];
        for (let j = 0; j <= n; j++) seg.push(project(-halfSpan + i * stepW, -halfSpan + j * stepW, zAt(i, j)));
        paths.push('M' + seg.join(' L'));
    }
    for (let j = 0; j <= n; j++) {
        const seg = [];
        for (let i = 0; i <= n; i++) seg.push(project(-halfSpan + i * stepW, -halfSpan + j * stepW, zAt(i, j)));
        paths.push('M' + seg.join(' L'));
    }
    return paths;
}

const ind = (n) => ' '.repeat(n);

/* 곡면 파라미터는 한 곳에서만 정의한다. hero3d.js가 매 프레임 이 곡면을 다시 계산해
 * 파동을 흘려보내는데, 거기에 같은 숫자를 또 적어 두면 한쪽만 고쳤을 때 조용히
 * 어긋난다. 그래서 아래 data-* 속성으로 마크업에 실어 보내고 JS가 그걸 읽게 한다. */
const SURFACE = { span: 150, cells: 10, amp: 44 };

const rings = [230, 300, 372, 448]
    .map((r, i) => `${ind(28)}<ellipse cx="0" cy="0" rx="${r}" ry="${f(r * 0.3)}" opacity="${(0.5 - i * 0.09).toFixed(2)}"/>`)
    .join('\n');

const mesh = surfaceMesh(SURFACE.span, SURFACE.cells, SURFACE.amp)
    .map((d) => `${ind(28)}<path d="${d}"/>`)
    .join('\n');

const markup = `                <!-- 히어로 3D 무대.
                     perspective를 건 .hero-stage 안에서 각 도형이 서로 다른 translateZ에
                     놓여 있고, hero3d.js가 마우스 위치에 따라 .hero-stage-inner를 아주
                     조금 회전시킨다. 층별 이동량을 JS로 계산하지 않아도 브라우저의 원근
                     투영이 깊이에 비례한 시차(parallax)를 알아서 만들어 준다.

                     도형은 장식이 아니라 이 동아리가 다루는 대상 그 자체다 — 인볼류트
                     기어(동역학), z=sin(u)cos(v) 매개변수 곡면(수학), 좌표축과 치수선
                     (설계). figure1/figure2의 도해 언어를 어두운 배경으로 옮긴 것이다.
                     이 블록은 tools/build_hero_geometry.js가 수식으로 생성한 것이라
                     톱니 간격과 곡면 격자가 실제로 균일하다 — 모양을 바꾸려면 손으로
                     좌표를 고치지 말고 그 스크립트를 다시 돌릴 것.

                     aria-hidden: 순수 장식이라 스크린 리더가 읽을 내용이 없다. -->
                <div class="hero-stage" aria-hidden="true">
                    <div class="hero-stage-inner">

                        <!-- 최심층: 동심 궤도 링 -->
                        <svg class="hero-geo hero-geo-rings" viewBox="-460 -160 920 320" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke">
${rings}
                        </svg>

                        <!-- 심층: 매개변수 곡면 와이어프레임.
                             아래 path의 d값은 위상 t=0인 정지 상태다 — hero3d.js가 붙으면
                             매 프레임 다시 계산해 파동이 흐른다. JS가 없거나 모션 최소화
                             설정이면 이 정지 상태 그대로 남는다. -->
                        <svg class="hero-geo hero-geo-surface" viewBox="-280 -220 560 440" fill="none" stroke="currentColor" stroke-width="0.9"\n                             data-span="${SURFACE.span}" data-cells="${SURFACE.cells}" data-amp="${SURFACE.amp}">
${mesh}
                        </svg>

                        <!-- 중간층: 큰 기어. 자전은 바깥 <svg>가 아니라 안쪽 .gear-rotor가 맡는다 —
                             <svg>에는 이미 배치용 translate3d가 걸려 있어서 거기에 회전을
                             더하면 제자리 자전이 아니라 무대 중심을 도는 공전이 된다. -->
                        <svg class="hero-geo hero-geo-gear-lg" viewBox="-190 -190 380 380" fill="none" stroke="currentColor" stroke-width="1.4">
${ind(28)}<g class="gear-rotor">
${ind(32)}<path d="${gearPath(168, 136, 28)}"/>
${ind(32)}<circle cx="0" cy="0" r="118"/>
${ind(32)}<circle cx="0" cy="0" r="46"/>
${ind(32)}<circle cx="0" cy="0" r="26"/>
${ind(32)}<g opacity="0.55">
${ind(36)}<path d="M0,-118 L0,-46 M0,46 L0,118 M-118,0 L-46,0 M46,0 L118,0"/>
${ind(36)}<path d="M-83,-83 L-33,-33 M83,83 L33,33 M83,-83 L33,-33 M-83,83 L-33,33"/>
${ind(32)}</g>
${ind(28)}</g>
                        </svg>

                        <!-- 중간층: 작은 기어 (기어비대로 더 빠르게 역방향 자전) -->
                        <svg class="hero-geo hero-geo-gear-sm" viewBox="-110 -110 220 220" fill="none" stroke="currentColor" stroke-width="1.6">
${ind(28)}<g class="gear-rotor">
${ind(32)}<path d="${gearPath(96, 77, 18)}"/>
${ind(32)}<circle cx="0" cy="0" r="62"/>
${ind(32)}<circle cx="0" cy="0" r="24"/>
${ind(32)}<path d="M0,-62 L0,-24 M0,62 L0,24 M-62,0 L-24,0 M62,0 L24,0" opacity="0.55"/>
${ind(28)}</g>
                        </svg>

                        <!-- 최전면: 좌표축 · 치수선 (설계 도면의 언어) -->
                        <svg class="hero-geo hero-geo-axes" viewBox="-200 -150 400 300" fill="none" stroke="currentColor" stroke-width="1">
${ind(28)}<path d="M-150,110 L150,110" opacity="0.8"/>
${ind(28)}<path d="M-150,110 L-150,-90" opacity="0.8"/>
${ind(28)}<path d="M150,110 L142,105 M150,110 L142,115" opacity="0.8"/>
${ind(28)}<path d="M-150,-90 L-155,-82 M-150,-90 L-145,-82" opacity="0.8"/>
${ind(28)}<g opacity="0.45">
${ind(32)}<path d="M-90,106 L-90,114 M-30,106 L-30,114 M30,106 L30,114 M90,106 L90,114"/>
${ind(32)}<path d="M-154,60 L-146,60 M-154,10 L-146,10 M-154,-40 L-146,-40"/>
${ind(28)}</g>
${ind(28)}<g opacity="0.3" stroke-dasharray="4 5">
${ind(32)}<path d="M-90,110 L-90,-40 L90,-40"/>
${ind(32)}<path d="M30,110 L30,10"/>
${ind(28)}</g>
                        </svg>

                    </div>
                </div>`;

const outFlag = process.argv.indexOf('-o');
if (outFlag !== -1 && process.argv[outFlag + 1]) {
    require('fs').writeFileSync(process.argv[outFlag + 1], markup + '\n');
    console.error(`wrote ${process.argv[outFlag + 1]} (${markup.length} bytes)`);
} else {
    process.stdout.write(markup + '\n');
}
