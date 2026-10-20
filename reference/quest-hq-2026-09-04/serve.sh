#!/bin/sh
# Serves the Quest HQ reference copy at http://127.0.0.1:4320 (open app.html?preview=1#/new).
cd "$(dirname "$0")/site" && exec python3 -m http.server 4320 --bind 127.0.0.1
