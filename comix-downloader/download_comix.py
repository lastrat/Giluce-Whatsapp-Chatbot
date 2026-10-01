"""
Download webtoon chapters from Comix.to and output as JSON.
Usage: python download_comix.py <manga_code> <chapters|list> [--pdf]
"""

import sys
import json
import base64
import asyncio
import tempfile
import subprocess
import os
import re
from pathlib import Path

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.api.comix import ComixAPI


def extract_manga_code(input_str: str) -> str:
    if not input_str:
        return input_str
    input_str = input_str.strip()
    if input_str.lower().startswith('http'):
        match = re.search(r'/title/([^/?#]+)', input_str)
        if match:
            return match.group(1)
    return input_str


def parse_chapters(chapters_str: str, total_chapters: list) -> list:
    chapters_str = chapters_str.strip().lower()
    if chapters_str == 'all':
        return total_chapters
    selected = []
    if '-' in chapters_str:
        parts = chapters_str.split('-')
        if len(parts) == 2:
            start, end = int(parts[0]), int(parts[1])
            for ch in total_chapters:
                ch_num = float(ch['number']) if ch['number'] else 0
                if start <= ch_num <= end and ch not in selected:
                    selected.append(ch)
    else:
        numbers = [int(x) for x in __import__('re').split(r'[\s,]+', chapters_str) if x.isdigit()]
        for num in numbers:
            for ch in total_chapters:
                if ch['number'] == str(num) and ch not in selected:
                    selected.append(ch)
    return selected


async def main_async(manga_code: str, chapters_str: str, output_format: str = 'images'):
    try:
        manga = await ComixAPI._get_manga_info_async(manga_code, headless=True)
        manga_slug = manga.slug or manga.hash_id or manga_code
        chapters = await ComixAPI._get_all_chapters_async(manga_code, headless=True)
        
        if not chapters:
            print(json.dumps({"ok": False, "error": "No chapters found"}))
            return
        
        if chapters_str.strip().lower() == 'list':
            chapter_list = []
            for ch in chapters:
                chapter_list.append({
                    'chapter_id': ch['chapter_id'],
                    'number': ch['number'],
                    'title': ch.get('title', '')
                })
            result = {
                "ok": True,
                "manga": {
                    "code": manga_code,
                    "title": manga.title,
                    "slug": manga_slug,
                    "manga_type": manga.manga_type,
                    "status": manga.status,
                    "poster_url": manga.poster_url,
                    "latest_chapter": manga.latest_chapter
                },
                "chapters": chapter_list,
                "output_format": "list",
                "total_chapters": len(chapters)
            }
            print(json.dumps(result))
            return
        
        selected_chapters = parse_chapters(chapters_str, chapters)
        if not selected_chapters:
            print(json.dumps({"ok": False, "error": "Invalid chapter selection"}))
            return
        
        seen = set()
        unique_chapters = []
        for ch in selected_chapters:
            key = ch['number']
            if key not in seen:
                seen.add(key)
                unique_chapters.append(ch)
        selected_chapters = unique_chapters
        
        output_dir = Path(tempfile.mkdtemp(prefix='comix-dl-'))
        chapters_data = []
        
        if output_format == 'pdf':
            for ch in selected_chapters:
                ch_output_dir = output_dir / f"Chapter_{ch['number']}"
                ch_output_dir.mkdir(parents=True, exist_ok=True)
                
                cmd = [
                    sys.executable,
                    str(project_root / 'main.py'),
                    'download',
                    f'https://comix.to/title/{manga_slug}',
                    '--chapters', str(ch['number']),
                    '--format', 'pdf',
                    '--output', str(ch_output_dir),
                    '--headless'
                ]
                
                env = {
                    'PYTHONIOENCODING': 'utf-8',
                    'PYTHONUNBUFFERED': '1'
                }
                
                result_proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=600,
                    cwd=str(project_root),
                    env={**os.environ, **env}
                )
                
                pdf_files = list(ch_output_dir.rglob('*.pdf'))
                if pdf_files:
                    pdf_path = pdf_files[0]
                    chapters_data.append({
                        'chapter_id': ch['chapter_id'],
                        'number': ch['number'],
                        'title': ch.get('title', ''),
                        'pdf_path': str(pdf_path),
                        'file_name': f"{manga.title.replace('/', '_')}_Chapter_{ch['number']}.pdf"
                    })
        else:
            chapters_arg = ','.join(ch['number'] for ch in selected_chapters)
            cmd = [
                sys.executable,
                str(project_root / 'main.py'),
                'download',
                f'https://comix.to/title/{manga_slug}',
                '--chapters', chapters_arg,
                '--format', 'images',
                '--output', str(output_dir),
                '--headless'
            ]
            
            env = {
                'PYTHONIOENCODING': 'utf-8',
                'PYTHONUNBUFFERED': '1'
            }
            
            result_proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
                cwd=str(project_root),
                env={**os.environ, **env}
            )
            
            manga_dir = None
            for entry in output_dir.iterdir():
                if entry.is_dir():
                    manga_dir = entry
                    break
            
            if manga_dir:
                for ch in selected_chapters:
                    ch_title_safe = ch.get('title', '').replace('/', '_').replace('\\', '_')
                    ch_dir_name = f"Chapter_{ch['number']}_{ch_title_safe}"
                    ch_dir = manga_dir / ch_dir_name
                    images = []
                    if ch_dir.exists():
                        for img_file in sorted(ch_dir.glob('*.*')):
                            if img_file.suffix.lower() in {'.webp', '.jpg', '.jpeg', '.png'}:
                                img_bytes = img_file.read_bytes()
                                if len(img_bytes) >= 10240:
                                    images.append({
                                        'index': len(images) + 1,
                                        'data': base64.b64encode(img_bytes).decode('utf-8'),
                                        'mime': 'image/webp' if img_file.suffix == '.webp' else 'image/jpeg'
                                    })
                    chapters_data.append({
                        'chapter_id': ch['chapter_id'],
                        'number': ch['number'],
                        'title': ch.get('title', ''),
                        'images': images,
                        'page_count': len(images)
                    })
        
        result = {
            "ok": True,
            "manga": {
                "code": manga_code,
                "title": manga.title,
                "slug": manga_slug,
                "manga_type": manga.manga_type,
                "status": manga.status,
                "poster_url": manga.poster_url,
                "latest_chapter": manga.latest_chapter
            },
            "output_dir": str(output_dir),
            "output_format": output_format,
            "chapters": chapters_data,
            "total_chapters_downloaded": len(chapters_data)
        }
        print(json.dumps(result))
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}))


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: python download_comix.py <manga_code> <chapters|list> [--pdf]"}))
        sys.exit(1)
    manga_code = extract_manga_code(sys.argv[1])
    chapters_str = sys.argv[2]
    output_format = 'pdf' if '--pdf' in sys.argv else 'images'
    asyncio.run(main_async(manga_code, chapters_str, output_format))


if __name__ == "__main__":
    main()
