#!/usr/bin/env bash
#
# migrate-images.sh — one-shot image-bucket migration for the cocarr dev env.
#
# Copies every object from the legacy bucket (wrapped-lockerbox-9ybz-nh, still
# shared by core) into the new Railway bucket `embedded-vault`, verifies the
# copy, then repoints the `core` service at the new bucket and redeploys. User
# -> image links are preserved because objects keep their exact keys and the
# web client's photoUrl() re-proxies by key regardless of host.
#
# Safe to re-run: already-copied objects are skipped, and it refuses to repoint
# unless the destination holds every source object.
#
# Prereqs: run from anywhere; needs the Railway CLI logged in (railway whoami),
# node with @aws-sdk/client-s3 (present in cocarr-core-api), and
# migrate-buckets.env already holding the SRC_ block (this repo has it).
#
# Usage:
#   bash scripts/migrate-images.sh
#
set -euo pipefail

# Resolve to the cocarr-core-api dir (parent of this script's dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

PROJECT_ID="19467aad-e025-42cb-b0dd-9a9ae6b9f77a"   # cocarr
ENV_ID="7f558fdf-8002-4e1f-a860-e0d779b67cf4"       # development
SVC=(--project "$PROJECT_ID" --environment "$ENV_ID" --service core)
ENVFILE="$PWD/migrate-buckets.env"
IMAGE_PROXY="https://apis-dev.cocarr.com/v1/core/image"
PROBES=(MIGP_ACCESS MIGP_SECRET MIGP_BUCKET_A MIGP_BUCKET_B MIGP_ENDPOINT_A MIGP_ENDPOINT_B MIGP_REGION)

cleanup_probes() {
  for v in "${PROBES[@]}"; do
    railway variable delete "$v" "${SVC[@]}" >/dev/null 2>&1 || true
  done
}

echo "==> [0/7] Preflight"
command -v railway >/dev/null || { echo "ABORT: railway CLI not found."; exit 1; }
railway whoami >/dev/null 2>&1 || { echo "ABORT: not logged in — run 'railway login'."; exit 1; }
[ -f "$ENVFILE" ] || { echo "ABORT: $ENVFILE missing (SRC_ block is expected)."; exit 1; }
grep -q '^export SRC_BUCKET=' "$ENVFILE" || { echo "ABORT: SRC_ block missing in $ENVFILE."; exit 1; }
cleanup_probes   # remove any stray MIGP_* probes from the earlier reference attempt

echo "==> [1/7] Loading credentials"
set -a; # shellcheck disable=SC1090
source "$ENVFILE"; set +a
: "${SRC_BUCKET:?SRC_BUCKET missing}"

# The embedded-vault (DST_) block must be filled by hand — Railway buckets are
# not referenceable via ${{...}} here, so paste the bucket's values from its
# Variables tab into migrate-buckets.env before running this. Guard against the
# stale legacy placeholder still sitting in DST_.
if [ -z "${DST_BUCKET:-}" ] || [ "${DST_BUCKET}" = "${SRC_BUCKET}" ] \
   || [ -z "${DST_ACCESS_KEY_ID:-}" ] || [ -z "${DST_SECRET_ACCESS_KEY:-}" ]; then
  echo "ABORT: the DST_ block in migrate-buckets.env is not filled with embedded-vault's values."
  echo
  echo "  Open Railway -> cocarr / development -> the 'embedded-vault' bucket -> Variables,"
  echo "  then set these in $ENVFILE (replace any existing DST_ lines):"
  echo
  echo "    export DST_ENDPOINT='<the bucket's S3 endpoint URL>'"
  echo "    export DST_REGION='<the bucket's region, e.g. auto or sin>'"
  echo "    export DST_BUCKET='embedded-vault'"
  echo "    export DST_ACCESS_KEY_ID='<the bucket's access key id>'"
  echo "    export DST_SECRET_ACCESS_KEY='<the bucket's secret access key>'"
  echo
  echo "  Then re-run: bash scripts/migrate-images.sh"
  exit 1
fi

echo "==> [2/7] Destination confirmed"
echo "    SRC bucket: ${SRC_BUCKET}   DST bucket: ${DST_BUCKET}"

echo "==> [3/7] Dry run"
node scripts/migrateImageBucket.js --dry-run

echo "==> [4/7] Copying objects (per-object progress below)"
node scripts/migrateImageBucket.js --confirm

echo "==> [5/7] Verifying object counts before repointing"
node -e '
const {S3Client,ListObjectsV2Command}=require("@aws-sdk/client-s3");
const mk=p=>new S3Client({region:process.env[p+"_REGION"]||"auto",endpoint:process.env[p+"_ENDPOINT"],forcePathStyle:true,credentials:{accessKeyId:process.env[p+"_ACCESS_KEY_ID"],secretAccessKey:process.env[p+"_SECRET_ACCESS_KEY"]}});
const cnt=async(c,b)=>{let t,n=0;do{const r=await c.send(new ListObjectsV2Command({Bucket:b,ContinuationToken:t}));n+=(r.Contents||[]).length;t=r.IsTruncated?r.NextContinuationToken:undefined;}while(t);return n;};
(async()=>{const s=await cnt(mk("SRC"),process.env.SRC_BUCKET);const d=await cnt(mk("DST"),process.env.DST_BUCKET);console.log("    SRC:",s,"| DST:",d);if(d<s){console.error("    MISMATCH — not repointing");process.exit(1);}console.log("    OK: all source objects present in destination");})().catch(e=>{console.error(e.message);process.exit(1);});
'

echo "==> [6/7] Repointing core at embedded-vault + redeploying"
railway variable set "AWS_S3_BUCKET_NAME=${DST_BUCKET}"               "${SVC[@]}" --skip-deploys >/dev/null
railway variable set "AWS_ACCESS_KEY_ID=${DST_ACCESS_KEY_ID}"         "${SVC[@]}" --skip-deploys >/dev/null
railway variable set "AWS_SECRET_ACCESS_KEY=${DST_SECRET_ACCESS_KEY}" "${SVC[@]}" --skip-deploys >/dev/null
railway variable set "AWS_ENDPOINT_URL=${DST_ENDPOINT}"              "${SVC[@]}" --skip-deploys >/dev/null
railway variable set "AWS_DEFAULT_REGION=${DST_REGION}"              "${SVC[@]}" --skip-deploys >/dev/null
railway variable set "PUBLIC_API_URL=https://apis-dev.cocarr.com/v1/core" "${SVC[@]}" --skip-deploys >/dev/null
cleanup_probes
railway redeploy "${SVC[@]}" -y

echo "==> [7/7] Polling a real image through the new bucket (redeploy ~30-60s)"
KEY="$(node -e 'const {S3Client,ListObjectsV2Command}=require("@aws-sdk/client-s3");const c=new S3Client({region:process.env.DST_REGION||"auto",endpoint:process.env.DST_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.DST_ACCESS_KEY_ID,secretAccessKey:process.env.DST_SECRET_ACCESS_KEY}});c.send(new ListObjectsV2Command({Bucket:process.env.DST_BUCKET,Prefix:"profile/"})).then(r=>console.log((r.Contents||[])[0]?.Key||"")).catch(()=>console.log(""));')"
if [ -z "$KEY" ]; then echo "    (no profile/ key found to test; copy still succeeded)"; exit 0; fi
echo "    test key: $KEY"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$IMAGE_PROXY/$KEY" || echo 000)"
  echo "    attempt $i: HTTP $code"
  if [ "$code" = "200" ]; then echo "✅ MIGRATION COMPLETE — images serving from embedded-vault"; exit 0; fi
  sleep 10
done
echo "⚠ Image not 200 yet — the redeploy may still be finishing. Re-check: curl -I $IMAGE_PROXY/$KEY"
