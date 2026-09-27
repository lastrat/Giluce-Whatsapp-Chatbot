"""
Download webtoon chapters from Comix.to and output as JSON.
Usage: python download_comix.py <manga_code> <chapters>
"""

import sys
import json
import base64
import asyncio
from pathlib import Path

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.api.comix import ComixAPI


def parse_chapters(chapters_str: str, total_chapters: list) -> list:
    chapters_str = chapters_str.strip().lower()
    if chapters_str == 'all':
        return total_chapters
    selected = []
    if '-' in chapters_str:
        parts = chapters_str.split('-')
        if len(parts) == 2:
            start, end = int(parts[0]), int(parts[1])
            for i in range(start - 1, end):
                if 0 <= i < len(total_chapters):
                    selected.append(total_chapters[i])
    else:
        numbers = [int(x) for x in chapters_str.split() if x.isdigit()]
        for num in numbers:
            if 1 <= num <= len(total_chapters):
                selected.append(total_chapters[num - 1])
    return selected


async def download_chapter_images(chapter, manga_slug):
    try:
        report = await ComixAPI._get_chapter_images_async(
            chapter["chapter_id"],
            manga_slug=manga_slug,
            chapter_number=chapter["number"],
            headless=True
        )
        images = []
        for i, img_data in enumerate(report.image_urls):
            if isinstance(img_data, str) and img_data.startswith('data:image/'):
                header, b64_data = img_data.split(',', 1)
                img_bytes = base64.b64decode(b64_data)
            else:
                import requests
                response = requests.get(img_data, timeout=30, headers={'User-Agent': 'Mozilla/5.0'})
                img_bytes = response.content
            images.append({
                'index': i + 1,
                'data': base64.b64encode(img_bytes).decode('utf-8'),
                'mime': 'image/webp' if isinstance(img_data, str) and img_data.startswith('data:image/webp') else 'image/jpeg'
            })
        return {
            'chapter_id': chapter["chapter_id"],
            'number': chapter["number"],
            'title': chapter.get("title", ""),
            'images': images,
            'page_count': len(images),
            'skipped_pages': report.skipped_pages,
            'failed_pages': report.failed_pages
        }
    except Exception as e:
        return {
            'chapter_id': chapter["chapter_id"],
            'number': chapter["number"],
            'title': chapter.get("title", ""),
            'error': str(e),
            'images': []
        }


async def main_async(manga_code: str, chapters_str: str):
    try:
        manga = await ComixAPI._get_manga_info_async(manga_code, headless=True)
        manga_slug = manga.slug or manga.hash_id or manga_code
        chapters = await ComixAPI._get_all_chapters_async(manga_code, headless=True)
        
        if not chapters:
            print(json.dumps({"ok": False, "error": "No chapters found"}))
            return
        
        selected_chapters = parse_chapters(chapters_str, chapters)
        if not selected_chapters:
            print(json.dumps({"ok": False, "error": "Invalid chapter selection"}))
            return
        
        chapters_data = []
        for chapter in selected_chapters:
            print(f"Downloading chapter {chapter['number']}...", file=sys.stderr)
            chapter_data = await download_chapter_images(chapter, manga_slug)
            chapters_data.append(chapter_data)
        
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
            "chapters": chapters_data,
            "output_format": "images",
            "total_chapters_downloaded": len([c for c in chapters_data if c.get('images')])
        }
        print(json.dumps(result))
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}))


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: python download_comix.py <manga_code> <chapters>"}))
        sys.exit(1)
    manga_code = sys.argv[1]
    chapters_str = sys.argv[2]
    asyncio.run(main_async(manga_code, chapters_str))


if __name__ == "__main__":
    main()
