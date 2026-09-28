#!/usr/bin/env python3
"""Simple HTTP server for Quartz local preview.
Handles two GitHub Pages behaviors that python http.server lacks:
1. Serves .html files for extensionless URLs
2. Strips the baseUrl prefix (e.g. /obsidian-vault/ -> /)

Usage: python3 serve.py [PORT] [DIRECTORY]
Default: port 8080, directory = public/
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
DIRECTORY = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else "public")

# baseUrl from quartz.config.yaml — stripped for local serving
BASE_URL_PREFIX = "/obsidian-vault"

class QuartzHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        path = self.path.split('?')[0].split('#')[0]

        # Strip baseUrl prefix (e.g. /obsidian-vault/tags/moc -> /tags/moc)
        if path.startswith(BASE_URL_PREFIX):
            path = path[len(BASE_URL_PREFIX):] or "/"

        # If path has no extension, try serving path.html (GitHub Pages behavior)
        if '.' not in os.path.basename(path) and path != '/':
            html_path = path.rstrip('/') + '.html'
            if os.path.isfile(os.path.join(DIRECTORY, html_path.lstrip('/'))):
                path = html_path

        self.path = path
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    print(f"Serving {DIRECTORY} at http://localhost:{PORT}/")
    print(f"Stripping baseUrl prefix: {BASE_URL_PREFIX}")
    with http.server.HTTPServer(('0.0.0.0', PORT), QuartzHandler) as httpd:
        httpd.serve_forever()
