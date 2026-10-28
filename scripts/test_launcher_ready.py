from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time
import unittest
from unittest.mock import Mock

from launch import wait_ready


class ReadinessTests(unittest.TestCase):
    def test_slow_producer_discovery_can_complete(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                time.sleep(1.2)
                body = json.dumps({'execution': {'workflows': [{'backends': ['libtensorflow']}]}}).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers(); self.wfile.write(body)

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                wait_ready(Mock(poll=Mock(return_value=None)),
                           f'http://127.0.0.1:{server.server_port}/api/capabilities', 'libtensorflow', timeout=5)
            finally:
                server.shutdown(); thread.join()

    def test_exited_server_is_reported_without_waiting(self):
        with self.assertRaisesRegex(RuntimeError, 'status 7'):
            wait_ready(Mock(poll=Mock(return_value=7), returncode=7), 'http://127.0.0.1:1', 'libtensorflow')

    def test_readiness_has_an_overall_deadline(self):
        with self.assertRaisesRegex(RuntimeError, 'did not become ready'):
            wait_ready(Mock(poll=Mock(return_value=None)), 'http://127.0.0.1:1', 'libtensorflow', timeout=.1)
