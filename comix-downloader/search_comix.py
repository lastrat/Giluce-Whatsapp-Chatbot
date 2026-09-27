"""
Simple script to search Comix.to and output results as JSON.
Usage: python search_comix.py <query>
"""

import sys
import json
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.api.comix import ComixAPI

def search(query: str):
    try:
        results = ComixAPI.search_manga(query, page=1, limit=10, headless=True)
        items = []
        for summary in results.items:
            items.append({
                "manga_id": summary.manga_id,
                "manga_code": summary.manga_code,
                "title": summary.title,
                "poster_url": summary.poster_url,
                "manga_type": summary.manga_type or "Unknown",
                "status": summary.status or "Unknown",
                "year": summary.year or 0,
                "latest_chapter": summary.latest_chapter or "",
                "rated_avg": summary.rated_avg or 0,
                "content_rating": summary.content_rating or "safe",
                "canonical_url": summary.canonical_url,
            })
        print(json.dumps({"ok": True, "items": items}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "No query provided"}))
        sys.exit(1)
    
    query = " ".join(sys.argv[1:])
    search(query)
