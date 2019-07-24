#!/bin/sh

set -e

./docker/prod.sh run --rm app install

./docker/prod.sh up -d
