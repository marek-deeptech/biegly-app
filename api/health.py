"""Funkcja serverless Python na Vercel — sanity check runtime'u.

Potwierdza, że na Vercel działa warstwa Python (która docelowo uruchamia
zwalidowany silnik faktów). Dostępna pod /api/health.
"""
import json
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        payload = {"status": "ok", "runtime": "python", "service": "biegly-engine"}
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
