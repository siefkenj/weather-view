#!/usr/bin/env bash

set -eu

# Use vim as the default editor for git (commit messages, interactive rebase, etc.).
git config --global core.editor vim

# Install the WebAssembly build tools for rust/prefig-wasm:
# the wasm32 compilation target and wasm-pack.
rustup target add wasm32-unknown-unknown
curl -sSfL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
