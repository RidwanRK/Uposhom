#!/usr/bin/env bash
# Replays a sample of every Applink callback against a running API and checks that each one is
# acknowledged with {"statusCode":"S1000","statusDetail":"Success"}. Also sends a duplicate, a
# malformed body and a wrong content type: all of those must be acknowledged too, because a 4xx or
# 5xx only makes Applink retry the same payload.
#
# Usage:
#   scripts/replay-callbacks.sh http://localhost:3000            # local dev, no key
#   scripts/replay-callbacks.sh https://uposhom.duckdns.org KEY  # the VM, with the callback key
#
# The sample numbers are fake and unknown to the system, so nothing is sent to anyone: an MO SMS
# from an unknown number is ignored. (Do not edit these to a real number with STOP: that opts the
# number out and queues an Applink Unregister.)
set -u

BASE="${1:-}"
KEY="${2:-}"
if [ -z "$BASE" ]; then
  echo "usage: $0 <base-url> [callback-key]" >&2
  exit 2
fi
BASE="${BASE%/}"
PREFIX="$BASE/api/applink"
[ -n "$KEY" ] && PREFIX="$PREFIX/$KEY"

EXPECT='{"statusCode":"S1000","statusDetail":"Success"}'
FAIL=0
STAMP="$(date +%s)"

post() { # label path body [content-type]
  local label="$1" path="$2" body="$3" ctype="${4:-application/json;charset=utf-8}"
  local out code resp
  out="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$PREFIX/$path" -H "Content-Type: $ctype" --data-binary "$body")"
  code="$(printf '%s' "$out" | tail -n1)"
  resp="$(printf '%s' "$out" | sed '$d')"
  if [ "$code" = "200" ] && [ "$resp" = "$EXPECT" ]; then
    printf 'ok    %-34s %s\n' "$label" "$code"
  else
    printf 'FAIL  %-34s HTTP %s  %s\n' "$label" "$code" "$resp"
    FAIL=1
  fi
}

echo "Replaying callbacks against $BASE"

post "SMS receive (MO)" "sms/receive" \
  "{\"version\":\"1.0\",\"applicationId\":\"APP_REPLAY\",\"sourceAddress\":\"tel:8801000000000\",\"message\":\"UPOSHOM 1\",\"requestId\":\"replay-mo-$STAMP\",\"encoding\":\"0\"}"
post "SMS delivery report" "sms/report" \
  "{\"destinationAddress\":\"tel:8801000000000\",\"timeStamp\":\"20261122100000\",\"requestId\":\"replay-dlr-$STAMP\",\"deliveryStatus\":\"DELIVERED\"}"
post "Subscriber notification" "subscription/notify" \
  "{\"timeStamp\":\"20261122100000\",\"version\":\"1.0\",\"applicationId\":\"APP_REPLAY\",\"password\":\"not-a-real-password\",\"subscriberId\":\"tel:8801000000000\",\"frequency\":\"monthly\",\"status\":\"REGISTERED\"}"
post "Charging notification" "caas/charging-notification" \
  "{\"timeStamp\":\"22-Nov-2026 11:55\",\"TotalAmount\":\"5.00\",\"externalTrxId\":\"replay-$STAMP\",\"balanceDue\":\"0\",\"statusDetail\":\"Success\",\"currency\":\"BDT\",\"version\":\"1.0\",\"internalTrxId\":\"int-1\",\"paidAmount\":\"5.00\",\"referenceId\":\"ref-1\",\"statusCode\":\"S1000\"}"

echo "--- redelivery, bad input (all must still be acknowledged)"
post "duplicate of the MO above" "sms/receive" \
  "{\"version\":\"1.0\",\"applicationId\":\"APP_REPLAY\",\"sourceAddress\":\"tel:8801000000000\",\"message\":\"UPOSHOM 1\",\"requestId\":\"replay-mo-$STAMP\",\"encoding\":\"0\"}"
post "malformed JSON" "sms/receive" '{this is not json'
post "empty body" "sms/receive" ''
post "missing required fields" "sms/receive" '{"message":"no source, no requestId"}'
post "wrong content type" "sms/receive" 'plain text' 'text/plain'

echo
if [ "$FAIL" = "0" ]; then
  echo "All callbacks acknowledged with S1000."
else
  echo "Some callbacks were NOT acknowledged correctly." >&2
fi
exit "$FAIL"
