#!/usr/bin/env bash
# 一键启动：后端 :4000 + 前端 :5173，后台运行
# 日志：backend/run.log、frontend/vite-dev.log；停止：kill 对应 node 进程
cd "$(dirname "$0")"

(cd backend && nohup npm run dev > run.log 2> run.err.log &)
(cd frontend && nohup npm run dev > vite-dev.log 2> vite-dev.err.log &)

sleep 6
curl -s http://localhost:4000/api/health && echo
curl -s -o /dev/null -w "frontend http://localhost:5173  HTTP %{http_code}\n" http://localhost:5173/
