import type { Request, Response } from 'express';

// Vercel serverless entry point — wrap in try/catch so any init error returns JSON
let handler: ((req: Request, res: Response) => void) | null = null;

async function getHandler() {
  if (handler) return handler;
  const { default: app } = await import('../server/app');
  handler = app;
  return handler;
}

export default async function (req: Request, res: Response) {
  try {
    const h = await getHandler();
    h(req, res);
  } catch (err: any) {
    console.error('[api] Startup error:', err);
    res.status(500).json({ error: err?.message || 'Server failed to start' });
  }
}
