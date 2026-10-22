#!/bin/sh
# Pull the latest code and replace only the website.
# The database volume, bids, squads, purses, and uploaded photos stay.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

if [ ! -d .git ]; then
  echo "Run this from a git checkout of the app." >&2
  exit 1
fi

git pull --ff-only

echo "Building the new site. The one on screen keeps serving until the build finishes."
docker compose build web
docker compose up -d --no-deps web

echo "Update is live. Auction data was not reset."
