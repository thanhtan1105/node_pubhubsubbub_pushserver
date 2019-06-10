#!/bin/sh

set -e

./docker/prod.sh stop app

./docker/prod.sh rm -f app

./scripts/deploy/up.sh
