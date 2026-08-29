@echo off
rem Copy this file to scholarship-agent.env.cmd and edit the values for your server.
rem Keep the real scholarship-agent.env.cmd file private.

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "HOST=127.0.0.1"
set "PORT=4317"

set "PUBLIC_APP_URL=https://scholarships.example.com"
set "PORTAL_ADMIN_EMAIL=parent@example.com"
set "PORTAL_ADMIN_PASSWORD=replace-with-a-strong-password"
set "CRON_SECRET=replace-with-a-long-random-token"
set "APP_ENCRYPTION_KEY=replace-with-32-byte-base64-key"

rem Use manual invite links unless you verify an email sending domain.
set "INVITE_DELIVERY_MODE=manual"

rem Optional Resend email delivery after domain verification.
rem set "RESEND_API_KEY=re_replace-with-resend-api-key"
rem set "INVITE_EMAIL_FROM=Scholarship Agent <invites@example.com>"
