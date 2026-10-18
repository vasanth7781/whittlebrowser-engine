#!/bin/sh
# Installs browser-use (Python, via uv) and Stagehand (npm) for the benchmark comparison columns.
set -e
cd "$(dirname "$0")"
uv venv -q --python 3.12 .venv
uv pip install -q --python .venv/bin/python browser-use==0.13.11 tiktoken
(cd stagehand && npm install --silent)
echo "comparison tools ready: run pnpm bench -- --live --pw-mcp"
