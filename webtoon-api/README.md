"""
Webtoon Downloader API - Search and download webtoons as PDF.

Installation:
    pip install -r requirements.txt

Usage:
    # Start the API server
    python main.py
    
    # Or with uvicorn directly
    uvicorn main:app --host 0.0.0.0 --port 8001

API Endpoints:
    GET  /                    - Health check
    POST /search              - Search webtoons
    GET  /webtoon/{id}        - Get webtoon info
    POST /download            - Start download task
    GET  /download/{task_id}  - Check download status
    GET  /download/{task_id}/file - Download generated PDF

Examples:
    # Search for webtoons
    curl -X POST "http://localhost:8001/search" \\
         -H "Content-Type: application/json" \\
         -d '{"query": "tower of god", "source": "webtoon"}'
    
    # Get webtoon info
    curl "http://localhost:8001/webtoon/1234?source=webtoon"
    
    # Start download
    curl -X POST "http://localhost:8001/download" \\
         -H "Content-Type: application/json" \\
         -d '{"webtoon_url": "https://www.webtoons.com/...", "output_format": "pdf"}'
    
    # Check download status
    curl "http://localhost:8001/download/{task_id}"
    
    # Download PDF file
    curl "http://localhost:8001/download/{task_id}/file" -o webtoon.pdf
"""
