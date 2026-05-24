FROM emscripten/emsdk:3.1.56

ARG SKIA_REF=chrome/m120
ENV SKIA_REF=${SKIA_REF}
ENV PATH="/opt/depot_tools:${PATH}"
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        python3 \
        python3-pip \
        ninja-build \
        curl \
        ca-certificates \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth=1 https://chromium.googlesource.com/chromium/tools/depot_tools.git /opt/depot_tools

WORKDIR /workspace
RUN git clone --depth=1 -b ${SKIA_REF} https://skia.googlesource.com/skia.git

WORKDIR /workspace/skia
RUN python3 tools/git-sync-deps

COPY build.sh /workspace/build.sh
RUN chmod +x /workspace/build.sh

VOLUME /out
ENTRYPOINT ["/workspace/build.sh"]
