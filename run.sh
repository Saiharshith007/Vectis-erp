#!/bin/bash

# Change directory to the script's directory
cd "$(dirname "$0")"

echo "=================================================="
echo "  Vectis Launcher (macOS/Linux)"
echo "=================================================="
echo

# Check if python3 or python is installed
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
else
    echo "[ERROR] Python was not found on your system."
    echo "Please install Python 3 and try again."
    exit 1
fi

echo "Starting Python HTTP server on port 8000..."
# Start server in background
$PYTHON_CMD server.py &
SERVER_PID=$!

# Trap Ctrl+C to kill the background server process on exit
trap "echo -e '\nStopping server...'; kill $SERVER_PID; exit 0" SIGINT SIGTERM

# Wait 2 seconds for server to initialize
sleep 2

# Open default web browser
echo "Opening browser to http://localhost:8000..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:8000"
else
    xdg-open "http://localhost:8000" 2>/dev/null || echo "Please open http://localhost:8000 in your browser."
fi

echo
echo "Server is running (PID: $SERVER_PID)!"
echo "To stop the server, press Ctrl+C in this terminal."
echo

# Wait for server process to finish
wait $SERVER_PID
