#!/bin/sh

exec docker logs --tail 10 -f pushappforocom_app_1 2>&1
