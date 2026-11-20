# Retain the official Judge0 CE release image and change only its environment dump.
FROM judge0/judge0:1.13.1@sha256:6b5d6a66aa19a8e878a52ea3c6a560afc1086734d96e2885b561fd5c6018f082

USER root
RUN sed -i "s#export | sudo tee /api/environment#export | grep -Ev 'declare -x (POSTGRES_PASSWORD|REDIS_PASSWORD|AUTHN_TOKEN|AUTHZ_TOKEN|SECRET_KEY_BASE)=' | sudo tee /api/environment#" \
    /api/scripts/server /api/scripts/workers \
 && ! grep -q "export | sudo tee /api/environment" /api/scripts/server \
 && ! grep -q "export | sudo tee /api/environment" /api/scripts/workers
