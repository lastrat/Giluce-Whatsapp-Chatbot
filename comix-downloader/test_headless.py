# -*- coding: utf-8 -*-
import asyncio
import sys
sys.path.insert(0, '.')
from src.api.comix import ComixAPI

async def test():
    try:
        result = ComixAPI.search_manga("just friends", headless=False)
        print("OK:", result.ok if hasattr(result, 'ok') else 'n/a')
        items = getattr(result, 'items', [])
        print("Items:", len(items))
        if items:
            print("First:", items[0].title)
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
