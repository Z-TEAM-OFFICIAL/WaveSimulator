import http.server
import socketserver
import webbrowser
import threading
import os

# ZEGA Project Configuration
PORT = 13222
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class ZegaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Ensure we are serving from the correct directory
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def open_browser():
    """Opens the browser to the local ZEGA server."""
    url = f"http://localhost:{PORT}"
    print(f"Launching WaveLab 3D at {url}...")
    webbrowser.open(url)

def start_server():
    """Starts the HTTP server."""
    # Allow port reuse to avoid 'Address already in use' errors
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), ZegaHandler) as httpd:
        print(f"ZEGA Operations Command: Server live on port {PORT}")
        # Start browser in a separate thread so it doesn't block the server
        threading.Timer(1.2, open_browser).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down ZEGA server.")
            httpd.shutdown()

if __name__ == "__main__":
    start_server()