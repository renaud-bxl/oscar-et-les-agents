#!/bin/zsh
cd "${0:A:h}"
if [[ -x .runtime/bin/node ]]; then
  exec .runtime/bin/node launch.mjs
elif [[ -x /opt/homebrew/bin/node ]]; then
  exec /opt/homebrew/bin/node launch.mjs
else
  exec node launch.mjs
fi
