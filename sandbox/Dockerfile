# 文档工作区沙箱：独立容器、无依赖、无构建步骤（Node 24 直接运行 .mjs）。
# 运行约束在 docker-compose*.yml 里：非 root、只读根文件系统、tmpfs 工作区、
# 无外网（internal network）、资源限额。不要在镜像里加入应用代码或密钥。
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY sandbox ./sandbox

USER node
EXPOSE 3200

CMD ["node", "sandbox/runner.mjs"]
