'use strict';
class NotConfiguredError extends Error {
  constructor(what) { super(`${what} is not configured. Fill it in .env (see .env.example).`); this.code = 'NOT_CONFIGURED'; }
}
class UpstreamError extends Error {
  constructor(msg, status, details) { super(msg); this.code = 'UPSTREAM_ERROR'; this.status = status; this.details = details; }
}
module.exports = { NotConfiguredError, UpstreamError };
