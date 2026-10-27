import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildServer } from './server.ts';

// stdout carries the MCP protocol; diagnostics go to stderr only.
serveStdio(() => buildServer());
