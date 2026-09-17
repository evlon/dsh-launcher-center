# launcher-server — dsh-launcher-center（零依赖，纯 Node 内置模块）
#
# 构建（ARM64 集群）：
#   docker build -t launcher-server:<tag> .
#
# 入口：server.js（支持 --port / --data / --token 参数）
# 数据：JSON 文件目录（--data 指定），需挂 PVC
# 依赖：无外部依赖，仅 node:http / node:fs / node:path / node:crypto
FROM node:22-slim

WORKDIR /app

# 复制服务端代码与静态资源
# 注意：server.js 只是入口薄壳，业务实现在 src/ 下：
#   src/routes/  端点处理    src/store/  数据读写
#   src/views/   页面 HTML   src/web/    管理页脚本模块（服务端按序拼成 /admin.js）
# 已不再有独立的 admin.js 文件（管理页脚本由 src/web/*.js 拼接生成）。
COPY server.js ./
COPY package.json ./
COPY src/ ./src/

# 数据目录（挂 PVC）
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081

# 端口/数据目录/管理 token 通过参数传入（见 chart 的 args）
CMD ["node", "server.js", "--port", "8081", "--data", "/data", "--token", "local-admin"]
