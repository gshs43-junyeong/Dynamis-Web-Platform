#!/usr/bin/env python3
"""UI 아이콘 PNG 빌더.

tools/icons/src/*.svg 를 헤드리스 Chromium으로 렌더해 public/icons/*.png 로 굽는다.
결과물(PNG)은 저장소에 커밋되어 있으므로, 아이콘 모양을 바꿀 때만 다시 돌리면 된다.

    python3 tools/icons/build_icons.py

[왜 PNG인가]
화면의 하트/작성자/작성시간 표시는 원래 이모지(🤍 ✍️ 📅 …)였다. 이모지는 기기가 가진
글꼴로 그려지기 때문에 안드로이드/윈도우/애플이 각각 다른 그림을 보여주고, 굵기와 색,
심지어 의미까지 달라 보인다(하트가 회색으로 나오거나 네모(􏿽)로 깨지는 환경도 있다).
사이트가 직접 소유한 PNG로 바꾸면 어느 기기에서 보든 같은 그림이 나온다.

[왜 브라우저로 굽는가]
이 저장소는 이미지 처리 의존성(sharp/canvas/cairosvg 등)을 두지 않는다. Playwright가
설치해 둔 Chromium이 이미 있어 추가 설치 없이 SVG를 정확히 렌더할 수 있으므로 그걸 쓴다.

[왜 크게 그린 뒤 잘라내는가]
헤드리스 Chromium은 --window-size 로 요청한 값보다 실제 뷰포트를 작게 잡는 경우가 있어
(특히 작은 창) 아이콘 우하단이 잘려 나간다. 실측 결과 128px 창에서는 아예 아무것도
그려지지 않았다. 그래서 목표 크기보다 넉넉히 큰 창에 그린 뒤, 좌상단에서 정확히 목표
크기만큼 잘라낸다. SVG 문서는 HTML과 달리 body 여백 없이 원점(0,0)부터 그려지므로
이 잘라내기가 정확히 아이콘 영역과 일치한다.

필요 조건: Python 3 + Pillow (pip install Pillow), 그리고 Chromium 실행 파일.
Chromium 경로는 CHROMIUM_PATH 환경변수로 지정할 수 있다.
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC_DIR = HERE / "src"
OUT_DIR = HERE.parent.parent / "public" / "icons"

# 실제 표시 크기는 13~18px 남짓이지만, 고배율(2x/3x) 화면에서도 또렷하도록 128px로
# 구워 CSS에서 줄여 쓴다. 단순한 선 아이콘이라 파일당 1KB 안팎이다.
SIZE = 128
# 렌더용 창은 목표 크기보다 크게 잡는다 (위 주석의 잘림 문제 회피).
WINDOW = SIZE + 320

CHROMIUM_CANDIDATES = [
    os.environ.get("CHROMIUM_PATH"),
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
]


def find_chromium() -> str:
    for candidate in CHROMIUM_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    sys.exit(
        "Chromium을 찾지 못했습니다. CHROMIUM_PATH 환경변수로 실행 파일 경로를 지정해 주세요."
    )


def sized_svg(svg_text: str) -> str:
    """<svg>의 width/height를 목표 크기로 바꾼다. viewBox는 그대로 두어 비율을 유지한다."""
    svg_text = re.sub(r'\swidth="[^"]*"', f' width="{SIZE}"', svg_text, count=1)
    svg_text = re.sub(r'\sheight="[^"]*"', f' height="{SIZE}"', svg_text, count=1)
    return svg_text


def render(chromium: str, svg_path: Path, out_path: Path, tmp_dir: Path) -> None:
    raw = tmp_dir / f"{out_path.stem}-raw.png"
    subprocess.run(
        [
            chromium,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",  # 투명 배경
            f"--window-size={WINDOW},{WINDOW}",
            f"--screenshot={raw}",
            svg_path.as_uri(),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    with Image.open(raw) as im:
        icon = im.convert("RGBA").crop((0, 0, SIZE, SIZE))
        if icon.getchannel("A").getbbox() is None:
            sys.exit(f"{out_path.name}: 렌더 결과가 비어 있습니다. SVG를 확인해 주세요.")
        icon.save(out_path, optimize=True)


def main() -> None:
    chromium = find_chromium()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = sorted(SRC_DIR.glob("*.svg"))
    if not sources:
        sys.exit(f"{SRC_DIR} 에 SVG가 없습니다.")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for src in sources:
            staged = tmp_dir / src.name
            staged.write_text(sized_svg(src.read_text(encoding="utf-8")), encoding="utf-8")
            out_path = OUT_DIR / f"{src.stem}.png"
            render(chromium, staged, out_path, tmp_dir)
            with Image.open(out_path) as im:
                bbox = im.getchannel("A").getbbox()
            print(f"  {out_path.name:20} {SIZE}x{SIZE}  {out_path.stat().st_size / 1024:.1f}KB  bbox={bbox}")

    print(f"\n{len(sources)}개 아이콘을 {OUT_DIR.relative_to(Path.cwd())} 에 생성했습니다.")


if __name__ == "__main__":
    main()
